/**
 * A drafted answer to a reply, from ONLY the conversation and the user's profile.
 *
 * Anything the draft would need but neither source says — a price for this exact
 * job, a date, a detail of their project — is left as a [gap in brackets], and the
 * Inbox won't send while one remains (the prototype's rule). checkDraft rejects a
 * number or link outside the brackets that isn't in what the model was shown, the
 * same idea as the first-line validator (lib/leads/opener.js).
 */
const Conversation = require('../../models/Conversation');
const Lead = require('../../models/Lead');
const Profile = require('../../models/Profile');
const Settings = require('../../models/Settings');
const { completeChecked } = require('../ai/complete');
const { CATEGORIES } = require('./classify');

const MAX = 1400;
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const outsideBrackets = (t) => String(t).replace(/\[[^\]]*\]/g, ' ');

function sourcesFor(convo, lead, profile, settings) {
  const thread = convo.messages.slice(-6).map(m => `${m.direction === 'in' ? 'THEM' : 'ME'} (${new Date(m.at).toDateString()}): ${String(m.text || '').slice(0, 1500)}`).join('\n\n');
  const money = (n) => (n ? `${profile.currency || 'INR'} ${n}` : '');
  const me = [
    profile.name || settings.senderName ? `Name: ${settings.senderName || profile.name}` : '',
    profile.headline ? `About me: ${profile.headline}` : '',
    ...(profile.services || []).map(s => `Service: ${s.name}${s.minBudget ? ` (from ${money(s.minBudget)})` : ''}`),
    profile.rate ? `Hourly rate: ${money(profile.rate)}` : '',
    profile.minProject ? `Smallest project: ${money(profile.minProject)}` : '',
    ...(profile.cases || []).map(c => `Result: ${c.title} — ${c.result}${c.url ? ` (${c.url})` : ''}`),
    ...(profile.proof || []).map(q => `Client quote: "${q.text}" — ${q.who}`),
    settings.bookingUrl ? `Booking link: ${settings.bookingUrl}` : '',
  ].filter(Boolean).join('\n');
  return { thread, me, lead: `${lead.person ? `${lead.person}, ` : ''}${lead.name}` };
}

/** Pure: null when acceptable, else the reason. */
function checkDraft(text, shownText) {
  const t = String(text || '').trim();
  if (t.length < 40) return 'too short';
  if (t.length > MAX) return `too long (${t.length} characters, max ${MAX})`;
  if (/\{\{|lorem ipsum|as an ai\b/i.test(t)) return 'contains a placeholder or AI talk';
  const seen = squash(shownText);
  const free = outsideBrackets(t);
  for (const n of free.match(/\d+(?:[.,]\d+)?/g) || []) {
    if (!seen.includes(squash(n)) && !seen.split(' ').includes(n.replace(/,/g, ''))) return `states a number that isn't in the thread or your profile (${n}) — put unknowns in [brackets]`;
  }
  for (const x of free.match(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+/gi) || []) {
    if (!seen.includes(squash(x))) return 'uses a link or address that is not in the thread or your profile';
  }
  return null;
}

async function draftReply(userId, conversationId) {
  const convo = await Conversation.findOne({ _id: conversationId, userId }).lean();
  if (!convo) return { ok: false, error: 'No such conversation' };
  const [lead, profile, settings] = await Promise.all([
    Lead.findOne({ _id: convo.leadId, userId }).lean(),
    Profile.findOne({ userId }).lean(),
    Settings.findOne({ userId }, { senderName: 1, bookingUrl: 1 }).lean(),
  ]);
  const src = sourcesFor(convo, lead || { name: convo.email }, profile || {}, settings || {});
  const wants = convo.category ? `Their latest reply was sorted as: ${CATEGORIES[convo.category]}.` : '';
  const system = `You draft a freelancer's email reply to a possible client. Rules:
- Answer THEIR latest message directly. Plain, warm, specific; 50-170 words; no subject line.
- Use ONLY facts in THE CONVERSATION and ABOUT ME. Never invent a price, timeline, date, result, link or detail.
- Where the reply needs something neither gives (a price for this job, a start date, a detail of their project), write a short placeholder in square brackets, e.g. [your price for this], [start date].
- If they want a call and a booking link is given, offer it. If they asked for samples, point to the results given.
- No "I hope this finds you well", no flattery. Sign off with my name.
Return only the email body.`;
  const prompt = `${wants}\n\nTHE CONVERSATION (with ${src.lead})\n${src.thread}\n\nABOUT ME\n${src.me || '(nothing saved)'}`;
  const shown = `${src.thread}\n${src.me}\n${src.lead}`;
  const r = await completeChecked(userId, { system, prompt, maxTokens: 350, temperature: 0.4 },
    { feature: 'draft', check: (t) => checkDraft(t, shown), context: { leadId: String(convo.leadId), company: lead && lead.name } });
  if (!r.ok) return { ok: false, error: r.error, noKeys: !!r.noKeys };
  return { ok: true, text: r.text.trim() };
}

/** The [gaps] still in a text. */
const gapsIn = (text) => [...new Set(String(text || '').match(/\[[^\]\n]{1,60}\]/g) || [])];

module.exports = { draftReply, checkDraft, gapsIn };
