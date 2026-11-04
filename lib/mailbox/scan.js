/**
 * Reading the user's Gmail for replies and bounces to outreach emails.
 *
 * Ported from Outreach's server.js (runMailboxCheck, parseBounces, tryMatchReply,
 * trySentReply): IMAP with the same app password; Inbox and Spam for replies and
 * bounces, Sent for answers typed straight into Gmail. Headers first, the full
 * message only when it could matter. Matching is by Message-ID (In-Reply-To /
 * References) against what we sent, with the same address + a "Re:" subject as
 * the fallback.
 *
 * What it does with them:
 *   reply  → the sequence stops (an out-of-office only pauses it), the lead moves
 *            to Replied, the message lands in its Conversation, sorted (lib/inbox/classify.js)
 *   "remove me" → also blocklisted and stopped as unsubscribed
 *   bounce → blocklisted, sequence stopped, the lead's email marked bad
 *
 * One scan per account at a time (a lease on Settings.mailbox.scanUntil) and a time
 * budget, so it fits a request. A scan cut short doesn't move lastCheckAt, so the
 * next one covers the same window; Message-IDs keep it from adding anything twice.
 */
const { simpleParser } = require('mailparser');
const Settings = require('../../models/Settings');
const SentEmail = require('../../models/SentEmail');
const Enrollment = require('../../models/Enrollment');
const Conversation = require('../../models/Conversation');
const Lead = require('../../models/Lead');
const Blocklist = require('../../models/Blocklist');
const mailer = require('../mailer');
const { classifyReply, stripQuoted, needsYouFor } = require('../inbox/classify');

const LOOKBACK_DAYS = 14;
const BUFFER_MS = 5 * 60 * 1000;
const LEASE_MS = 3 * 60 * 1000;
const DAY = 24 * 3600 * 1000;

const clean = (id) => String(id || '').trim().replace(/^<|>$/g, '') || null;
const bracket = (id) => (id ? `<${clean(id)}>` : null);

/** Pure: bounced addresses and why, from a delivery-failure report. From Outreach. */
function parseBounces(raw) {
  const hits = [];
  const re = /Final-Recipient:\s*rfc822;\s*<?([^\s>]+)>?/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const tail = raw.slice(m.index, m.index + 1000);
    const diag = tail.match(/Diagnostic-Code:\s*(?:smtp|x-[\w-]+);\s*([^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*)/i);
    const status = tail.match(/Status:\s*([\d.]+)/i);
    const reason = diag ? diag[1].replace(/\s+/g, ' ').trim() : (status ? `SMTP status ${status[1]}` : 'Bounced');
    // 4.x.x is a delay, not a failure.
    if (status && /^4\./.test(status[1])) continue;
    hits.push({ email: m[1].toLowerCase(), reason: reason.slice(0, 300) });
  }
  if (!hits.length) {
    const b = raw.match(/wasn'?t delivered to\s+([^\s]+@[^\s]+?)\s+because/i);
    if (b) hits.push({ email: b[1].replace(/[<>.,]+$/, '').toLowerCase(), reason: ((raw.match(/because[:\s]+(.{10,300}?)[\r\n]/i) || [])[1] || 'Bounced').trim() });
  }
  return hits;
}

/** Pure: the Message-IDs a message points at. */
const refsOf = (parsed) => [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])]
  .map(clean).filter(Boolean);

/** Take the lease. Null when another scan is running. */
async function claim(userId, now) {
  return Settings.findOneAndUpdate(
    { userId, $or: [{ 'mailbox.scanUntil': null }, { 'mailbox.scanUntil': { $lt: now } }] },
    { $set: { 'mailbox.scanUntil': new Date(now.getTime() + LEASE_MS) } },
    { returnDocument: 'after' },
  ).lean();
}

async function onBounce(userId, email, reason) {
  const sent = await SentEmail.findOne({ userId, to: email, kind: 'sequence' }).sort({ sentAt: -1 }).lean();
  if (!sent) return false;
  await Blocklist.blockEmail(userId, email, 'bounced');
  await Enrollment.updateMany({ userId, email, status: { $in: ['active', 'paused'] } },
    { $set: { status: 'stopped', stopReason: 'bounced', sendingUntil: null, lastError: `Bounced: ${reason}` } });
  // The address doesn't work: the lead goes back to waiting for a contact.
  await Lead.updateMany({ userId, email, status: { $in: ['in-sequence', 'approved', 'new'] } },
    { $set: { status: 'held', heldReason: `The email bounced (${reason.slice(0, 120)})`, emailConfidence: null, sequenceId: null } });
  return true;
}

/** Our side of the thread so far, for a conversation's first message. */
async function sentSoFar(userId, leadId) {
  const sent = await SentEmail.find({ userId, leadId }).sort({ sentAt: 1 }).limit(20).lean();
  return sent.map(s => ({ direction: 'out', from: s.from, subject: s.subject, text: s.text, messageId: s.messageId, inReplyTo: null, at: s.sentAt }));
}

async function onReply(userId, parsed, sent) {
  const msgId = bracket(parsed.messageId);
  if (msgId && await Conversation.exists({ userId, 'messages.messageId': msgId })) return null;
  const text = String(parsed.text || '').slice(0, 20_000);
  const verdict = await classifyReply(userId, { subject: parsed.subject || '', text, headers: parsed.headers });
  const at = parsed.date || new Date();
  const message = { direction: 'in', from: (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || sent.to, subject: parsed.subject || '', text: stripQuoted(text).slice(0, 8000) || text.slice(0, 8000), messageId: msgId, inReplyTo: bracket(parsed.inReplyTo), at };

  const existing = await Conversation.findOne({ userId, leadId: sent.leadId }, { _id: 1, category: 1 }).lean();
  const quiet = !needsYouFor(verdict.category);
  // An out-of-office on top of a real conversation changes nothing but the thread.
  const keepCategory = verdict.category === 'auto' && existing && existing.category && existing.category !== 'auto';
  const set = {
    email: sent.to, enrollmentId: sent.enrollmentId, lastInboundAt: at, lastAt: at, unread: true,
    ...(keepCategory ? {} : {
      category: verdict.category, categoryWhy: verdict.why || '', categoryBy: verdict.by,
      needsYou: !quiet, snoozedUntil: null, doneAt: null,
    }),
  };
  if (existing) {
    await Conversation.updateOne({ _id: existing._id }, { $set: set, $push: { messages: { $each: [message], $slice: -50 } } });
  } else {
    const ours = await sentSoFar(userId, sent.leadId);
    await Conversation.create({ userId, leadId: sent.leadId, subject: (ours[0] && ours[0].subject) || parsed.subject || '', messages: [...ours, message], ...set });
  }

  // The sequence: an auto-reply pauses it until they're back; anything else stops it.
  if (verdict.category === 'auto') {
    const back = verdict.backOn || new Date(Date.now() + 7 * DAY);
    await Enrollment.updateMany({ userId, leadId: sent.leadId, status: 'active' }, { $set: { status: 'paused', pausedUntil: back, sendingUntil: null } });
  } else {
    await Enrollment.updateMany({ userId, leadId: sent.leadId, status: { $in: ['active', 'paused'] } },
      { $set: { status: 'stopped', stopReason: verdict.stop ? 'unsubscribed' : 'replied', sendingUntil: null } });
    await Lead.updateOne({ userId, _id: sent.leadId, status: { $in: ['in-sequence', 'approved', 'new'] } }, { $set: { status: 'replied' } });
    if (verdict.stop) await Blocklist.blockEmail(userId, sent.to, 'asked-to-stop');
  }
  return { leadId: String(sent.leadId), category: verdict.category };
}

/** Something you typed in Gmail itself, answering a conversation we have. */
async function onSentReply(userId, parsed, convo) {
  const msgId = bracket(parsed.messageId);
  if (!msgId || await Conversation.exists({ userId, 'messages.messageId': msgId })) return false;
  if (await SentEmail.exists({ userId, messageId: msgId })) return false; // sent by Clientline
  const at = parsed.date || new Date();
  await Conversation.updateOne({ _id: convo._id }, {
    $push: { messages: { $each: [{ direction: 'out', from: '', subject: parsed.subject || '', text: stripQuoted(parsed.text || '').slice(0, 8000), messageId: msgId, inReplyTo: bracket(parsed.inReplyTo), at }], $slice: -50 } },
    // You answered: it no longer needs you.
    $set: { needsYou: false, lastAt: at },
  });
  return true;
}

/**
 * Checks this account's Gmail. Returns { ok, replies, bounces, skipped?, error? }.
 * `minIntervalMs` skips a check made too recently (opening a page).
 */
async function checkMailbox(userId, { budgetMs = 35_000, minIntervalMs = 0, now = new Date() } = {}) {
  const started = Date.now();
  const s = await Settings.findOne({ userId }, { mailbox: 1 }).lean();
  const last = s && s.mailbox && s.mailbox.lastCheckAt;
  if (minIntervalMs && last && now - last < minIntervalMs) return { ok: true, skipped: 'checked recently', replies: 0, bounces: 0 };
  // Nothing sent yet, nothing to look for.
  if (!(await SentEmail.exists({ userId }))) return { ok: true, skipped: 'nothing sent yet', replies: 0, bounces: 0 };
  if (mailer.dryRun()) return { ok: true, skipped: 'dry run', replies: 0, bounces: 0 };

  let sender;
  try { sender = await mailer.getSender(userId); } catch (err) { return { ok: false, error: err.message, replies: 0, bounces: 0 }; }
  if (!sender) return { ok: false, error: 'No Gmail connected', replies: 0, bounces: 0 };
  if (!(await claim(userId, now))) return { ok: true, skipped: 'a check is already running', replies: 0, bounces: 0 };

  const since = new Date(Math.max((last ? last.getTime() - BUFFER_MS : 0), now.getTime() - LOOKBACK_DAYS * DAY));
  const out = { ok: true, replies: 0, bounces: 0, scanned: 0, complete: false };
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: sender.email, pass: sender.appPassword }, logger: false });
  // A dropped socket is an 'error' event; without a listener it would kill the process.
  client.on('error', (err) => console.error(`[mailbox] IMAP error: ${err.message}`));
  const outOfTime = () => Date.now() - started > budgetMs;

  // What we've sent, so a message can be matched to it: by Message-ID, and by address.
  const sent = await SentEmail.find({ userId, sentAt: { $gt: new Date(since.getTime() - 60 * DAY) } }, { messageId: 1, to: 1, leadId: 1, enrollmentId: 1, sentAt: 1 }).lean();
  const byId = new Map(sent.filter(x => x.messageId).map(x => [clean(x.messageId), x]));
  const byTo = new Map();
  for (const x of sent) if (!byTo.has(x.to) || byTo.get(x.to).sentAt < x.sentAt) byTo.set(x.to, x);
  const addr = (list) => (list && list[0] && list[0].address ? list[0].address.toLowerCase() : '');

  try {
    await client.connect();
    const boxes = await client.list();
    const special = (flag, fallback) => (boxes.find(b => b.specialUse === flag) || { path: fallback }).path;

    for (const box of ['INBOX', special('\\Junk', '[Gmail]/Spam')]) {
      if (outOfTime()) break;
      let lock; try { lock = await client.getMailboxLock(box); } catch (_) { continue; }
      try {
        const [report, daemon, postmaster, all] = await Promise.all([
          client.search({ since, header: { 'content-type': 'multipart/report' } }, { uid: true }),
          client.search({ since, from: 'mailer-daemon' }, { uid: true }),
          client.search({ since, from: 'postmaster' }, { uid: true }),
          client.search({ since }, { uid: true }),
        ]);
        const bounceUids = new Set([...report, ...daemon, ...postmaster]);
        const uids = [...new Set([...bounceUids, ...all])];
        out.scanned += uids.length;
        // Headers only first (imapflow can't run a command inside a fetch loop).
        const heads = [];
        if (uids.length) for await (const m of client.fetch(uids, { uid: true, envelope: true, headers: ['references'] }, { uid: true })) heads.push(m);
        const wanted = heads.filter(m => {
          if (bounceUids.has(m.uid)) return true;
          const refs = ((m.headers ? m.headers.toString('utf8') : '').match(/<[^>]+>/g) || []).map(clean);
          if (m.envelope && m.envelope.inReplyTo) refs.push(clean(m.envelope.inReplyTo));
          return refs.some(r => byId.has(r)) || byTo.has(addr(m.envelope && m.envelope.from));
        }).map(m => m.uid);

        for (const uid of wanted) {
          if (outOfTime()) break;
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const raw = msg.source.toString('utf8');
          const hits = bounceUids.has(uid) || /multipart\/report|mailer-daemon|postmaster/i.test(raw.slice(0, 3000)) ? parseBounces(raw) : [];
          if (hits.length) {
            for (const h of hits) if (await onBounce(userId, h.email, h.reason)) out.bounces++;
            continue;
          }
          const parsed = await simpleParser(raw);
          const from = addr(parsed.from && parsed.from.value);
          if (!from || /mailer-daemon|postmaster/i.test(from)) continue;
          let match = refsOf(parsed).map(r => byId.get(r)).find(Boolean);
          // Fallback: same person, a "Re:" or auto-reply subject, after we wrote.
          if (!match && /^(?:re|aw|sv|automatic reply|auto-?reply|out of (?:the )?office)\s*:/i.test(String(parsed.subject || '').trim())) {
            const t = byTo.get(from);
            if (t && parsed.date && parsed.date > t.sentAt) match = t;
          }
          if (!match || !match.leadId) continue;
          if (await onReply(userId, parsed, match)) out.replies++;
        }
      } finally { lock.release(); }
    }

    // Answers you typed in Gmail, to people already in a conversation.
    if (!outOfTime()) {
      const convos = await Conversation.find({ userId }, { email: 1, 'messages.messageId': 1 }).lean();
      if (convos.length) {
        const convoBy = new Map(convos.map(c => [c.email, c]));
        const known = new Set(convos.flatMap(c => c.messages.map(m => clean(m.messageId))).filter(Boolean));
        let lock; try { lock = await client.getMailboxLock(special('\\Sent', '[Gmail]/Sent Mail')); } catch (_) { lock = null; }
        if (lock) {
          try {
            const uids = await client.search({ since }, { uid: true });
            const heads = [];
            if (uids.length) for await (const m of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) heads.push(m);
            for (const m of heads) {
              if (outOfTime()) break;
              const to = addr(m.envelope && m.envelope.to);
              const convo = convoBy.get(to);
              if (!convo || known.has(clean(m.envelope && m.envelope.messageId))) continue;
              const msg = await client.fetchOne(m.uid, { source: true }, { uid: true });
              if (!msg || !msg.source) continue;
              const parsed = await simpleParser(msg.source.toString('utf8'));
              await onSentReply(userId, parsed, convo);
            }
          } finally { lock.release(); }
        }
      }
    }
    out.complete = !outOfTime();
  } catch (err) {
    out.ok = false;
    out.error = mailer.isAuthError(err) ? 'Gmail refused the login — reconnect Gmail in Free connections.' : `Couldn’t read Gmail: ${err.message}`;
  } finally {
    try { await client.logout(); } catch (_) { /* already closed */ }
    await Settings.updateOne({ userId }, { $set: {
      'mailbox.scanUntil': null,
      'mailbox.lastError': out.error || null,
      // Only a complete scan moves the window; a cut-short one is redone next time.
      ...(out.complete ? { 'mailbox.lastCheckAt': now } : {}),
    } });
  }
  return out;
}

module.exports = { checkMailbox, parseBounces, refsOf, onReply, onBounce };
