/**
 * Paste → items. The user pastes anything: a WhatsApp or Telegram group export,
 * a newsletter, a single post. Each message that asks for help, or carries an
 * email, becomes an item for lib/leads/import.js; nothing is saved here.
 *
 * splitChunks is from Outreach's lib/sources/paste.js unchanged. The rest is
 * Clientline's: a message is kept when it reads like a request (the gates make
 * the final call), and the sender's name is read from the chat line.
 */
const { extractEmails, extractLinks, domainOf, isCompanyEmail } = require('./emails');
const { NEEDS } = require('../leads/gates');
const { quote, nameFromDomain } = require('./text');

const MAX_TEXT = 300 * 1024;
const MAX_CHUNKS = 120;
const CHUNK_MAX = 2000;

// A new message starts on a line like these:
//   WhatsApp: "[12/10/26, 9:41 PM] Name: …" or "12/10/2026, 21:41 - Name: …"
//   Telegram (desktop export, text): "Name, [12.10.26 21:41]"
const MESSAGE_START = /^(?:\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}|.{1,60},\s*\[\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s+\d{1,2}[:.]\d{2})/;
const WHATSAPP_PREFIX = /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\]?\s*(?:-\s*)?/i;
const TELEGRAM_PREFIX = /^(.{1,60}),\s*\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+(\d{1,2})[:.](\d{2})\]\s*/;

/** Pure: split pasted text into messages. Chat exports by message, anything else by blank lines. */
function splitChunks(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const chatLines = lines.filter(l => MESSAGE_START.test(l)).length;
  let chunks;
  if (chatLines >= 3) {
    chunks = [];
    for (const line of lines) {
      if (MESSAGE_START.test(line) || !chunks.length) chunks.push(line);
      else chunks[chunks.length - 1] += `\n${line}`;
    }
  } else {
    chunks = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  }
  return chunks.map(c => c.trim()).filter(Boolean);
}

// Chat dates are day-first in India and most of the world. A date that can only be
// month-first (13/…) flips; anything that doesn't make a real date is dropped.
function chatDate(d, m, y, hh, mm, ampm) {
  let day = Number(d); let month = Number(m);
  if (month > 12 && day <= 12) [day, month] = [month, day];
  let year = Number(y); if (year < 100) year += 2000;
  let hour = Number(hh);
  if (ampm && /p/i.test(ampm) && hour < 12) hour += 12;
  if (ampm && /a/i.test(ampm) && hour === 12) hour = 0;
  const at = new Date(Date.UTC(year, month - 1, day, hour, Number(mm)) - 5.5 * 3600 * 1000); // IST
  return Number.isNaN(at.getTime()) || month < 1 || month > 12 ? null : at;
}

/** Pure: one message → { sender, body, at }. */
function readMessage(chunk) {
  let body = chunk; let sender = ''; let at = null;
  const wa = chunk.match(WHATSAPP_PREFIX);
  if (wa) {
    at = chatDate(wa[1], wa[2], wa[3], wa[4], wa[5], wa[6]);
    body = chunk.slice(wa[0].length);
    const s = body.match(/^([^:\n]{1,40}):\s/);
    if (s) { sender = s[1].trim(); body = body.slice(s[0].length); }
  } else {
    const tg = chunk.match(TELEGRAM_PREFIX);
    if (tg) {
      sender = tg[1].trim();
      at = chatDate(tg[2], tg[3], tg[4], tg[5], tg[6]);
      body = chunk.slice(tg[0].length);
    }
  }
  // Phone numbers as sender names ("+91 98xxx") say nothing.
  if (/^[+\d\s()-]+$/.test(sender)) sender = '';
  return { sender, body: body.trim(), at };
}

/**
 * Pure: pasted text → items for lib/leads/import.js.
 * @returns {{ items: object[], messages: number, tooLong: boolean }}
 */
function pasteToItems(text, now = new Date()) {
  const raw = String(text || '');
  const tooLong = raw.length > MAX_TEXT;
  const chunks = splitChunks(raw.slice(0, MAX_TEXT));
  const items = [];
  for (const chunk of chunks) {
    const { sender, body, at } = readMessage(chunk);
    const clipped = body.slice(0, CHUNK_MAX);
    const emails = extractEmails(clipped);
    // Worth judging: it asks for someone, or it carries a way to reach them.
    if (!emails.length && !NEEDS.test(clipped)) continue;
    const company = emails.find(isCompanyEmail);
    const domain = company ? domainOf(company) : null;
    items.push({
      source: 'paste',
      sourceType: 'asked',
      text: clipped,
      name: domain ? nameFromDomain(domain) : (sender || ''),
      person: sender,
      domain,
      emails: emails.map(email => ({ email, confidence: 'high' })),
      links: extractLinks(clipped).slice(0, 5),
      where: sender ? `Your pasted chat · ${sender}` : 'Your pasted text',
      postedAt: at && at <= now ? at : null,
      signals: [{ text: quote(clipped), source: 'Your pasted chat', url: null, at: at || null }],
    });
    if (items.length >= MAX_CHUNKS) break;
  }
  return { items, messages: chunks.length, tooLong };
}

module.exports = { pasteToItems, splitChunks, readMessage, MAX_TEXT };
