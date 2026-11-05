/**
 * Sending what's due, when the user presses "Send due emails" (no scheduler yet).
 *
 * For each active enrolment whose next step is due, in a sequence that is
 * running: check it may still be sent (still in the sequence, not blocked, not
 * emailed in the last day, renders with no gap), CLAIM it, send from the user's
 * Gmail, record it, and schedule the next step. The claim (sendingUntil, set in
 * one atomic update that only matches an unclaimed enrolment at that step) is what
 * makes two presses — or two tabs — unable to send the same email twice.
 *
 * Follow-ups go in the same Gmail thread (In-Reply-To/References, "Re:" subject).
 * Every email carries List-Unsubscribe headers (one-click opt-out for mail apps,
 * and what Gmail looks for from a careful sender) but no visible unsubscribe line:
 * these are one-to-one notes, and a footer link makes them read like a newsletter.
 * Replying "no" / "remove me" stops and blocks (lib/inbox/classify.js).
 *
 * Patterns from Outreach's inngest-fns.js send path and lib/sendQuota.js; the
 * claim-before-send is new (Outreach's retries could double-send).
 */
const Enrollment = require('../../models/Enrollment');
const Sequence = require('../../models/Sequence');
const SentEmail = require('../../models/SentEmail');
const Lead = require('../../models/Lead');
const Profile = require('../../models/Profile');
const Settings = require('../../models/Settings');
const Blocklist = require('../../models/Blocklist');
const mailer = require('../mailer');
const { loadBlocklistSets, isBlocked } = require('../blocklist');
const { renderStep, whyBlocked } = require('./render');
const { unsubscribeUrl } = require('./unsubscribe');

const DAY = 24 * 3600 * 1000;
const CLAIM_MS = 2 * 60 * 1000;
const PAUSE_MS = 60 * 60 * 1000;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Plain text → the simple HTML Gmail shows: paragraphs kept, links clickable. */
function toHtml(text) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split(/\n{2,}/).map(p => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
}

/** What's due now, for the Outreach page: emails, tasks, and today's room. */
async function dueSummary(userId, now = new Date()) {
  const [seqs, settings, sentToday] = await Promise.all([
    Sequence.find({ userId }, { name: 1, active: 1, steps: 1, newPerDay: 1 }).lean(),
    Settings.findOne({ userId }, { sendsPerDay: 1, sendingPausedUntil: 1, senderName: 1, bookingUrl: 1 }).lean(),
    SentEmail.sentToday(userId),
  ]);
  const running = new Map(seqs.filter(s => s.active).map(s => [String(s._id), s]));
  const due = await Enrollment.find({ userId, status: 'active', nextAt: { $lte: now } }, { sequenceId: 1, step: 1, leadId: 1, nextAt: 1, email: 1, threadSubject: 1, edits: 1 }).sort({ nextAt: 1 }).lean();
  let first = 0; let followUps = 0; let tasks = 0; let pausedSeq = 0;
  const taskList = [];
  const emails = [];
  for (const e of due) {
    const s = running.get(String(e.sequenceId));
    if (!s) { pausedSeq++; continue; }
    const step = s.steps[e.step];
    if (!step) continue;
    if (step.kind === 'task') { tasks++; taskList.push({ enrollmentId: String(e._id), leadId: String(e.leadId), sequence: s.name, text: step.body }); }
    else {
      if (e.step === 0) first++; else followUps++;
      if (emails.length < 50) emails.push({ e, s, step });
    }
  }
  // Who exactly is about to be emailed, with the subject as it will go out — or why it can't.
  const [leadsForEmails, profile] = await Promise.all([
    Lead.find({ userId, _id: { $in: emails.map(x => x.e.leadId) } }).lean(),
    Profile.findOne({ userId }).lean(),
  ]);
  const leadById = new Map(leadsForEmails.map(l => [String(l._id), l]));
  const items = emails.map(({ e, s, step }) => {
    const lead = leadById.get(String(e.leadId));
    const edited = e.edits && e.edits.step === e.step ? e.edits : null;
    const r = edited ? { ok: true, subject: edited.subject, body: edited.body }
      : lead ? renderStep(e.step === 0 ? step : { ...step, subject: '' }, lead, profile || {}, settings || {}) : { ok: false, missing: [], unknown: [] };
    return {
      enrollmentId: String(e._id), leadId: String(e.leadId), name: lead ? (lead.person ? `${lead.person} · ${lead.name}` : lead.name) : 'A lead',
      email: e.email, sequence: s.name, step: e.step + 1, steps: s.steps.length, followUp: e.step > 0,
      subject: r.ok ? (e.step === 0 ? r.subject : `Re: ${e.threadSubject}`) : null,
      body: r.ok ? r.body : null,
      edited: !!edited,
      blocked: r.ok ? null : (lead ? whyBlocked(r) : 'The lead no longer exists'),
    };
  });
  if (taskList.length) {
    const names = await Lead.find({ userId, _id: { $in: taskList.map(t => t.leadId) } }, { name: 1, person: 1 }).lean();
    const by = Object.fromEntries(names.map(l => [String(l._id), l]));
    for (const t of taskList) t.lead = by[t.leadId] ? (by[t.leadId].person ? `${by[t.leadId].person}, ${by[t.leadId].name}` : by[t.leadId].name) : '';
  }
  const perDay = (settings && settings.sendsPerDay) || 40;
  const pausedUntil = settings && settings.sendingPausedUntil && settings.sendingPausedUntil > now ? settings.sendingPausedUntil : null;
  return { first, followUps, items, tasks: taskList, inPausedSequences: pausedSeq, sentToday, sendsPerDay: perDay, roomToday: Math.max(0, perDay - sentToday), pausedUntil };
}

/**
 * One batch. Returns { sent, skipped: [{name, reason}], stoppedBy, pausedUntil, more, last }.
 * `more` is true when there is still something due that this batch didn't reach.
 */
async function sendDue(userId, { budgetMs = 40_000, max = 15, now = new Date(), only = null } = {}) {
  const started = Date.now();
  const out = { sent: 0, skipped: [], stoppedBy: null, pausedUntil: null, more: false };

  const settings = await Settings.findOne({ userId }, { sendsPerDay: 1, sendingPausedUntil: 1, senderName: 1, bookingUrl: 1 }).lean() || {};
  if (settings.sendingPausedUntil && settings.sendingPausedUntil > now) {
    return { ...out, stoppedBy: 'Gmail’s daily limit was reached — sending waits until it resets.', pausedUntil: settings.sendingPausedUntil };
  }
  let sender;
  try { sender = await mailer.getSender(userId); }
  catch (err) { return { ...out, stoppedBy: err.message }; }
  if (!sender) return { ...out, stoppedBy: 'Connect Gmail in Free connections first.' };
  if (!unsubscribeUrl(userId, userId, sender.email)) return { ...out, stoppedBy: 'The app’s public address (CLIENTLINE_URL) is not set, so the unsubscribe link can’t be made.' };

  let room = Math.max(0, (settings.sendsPerDay || 40) - await SentEmail.sentToday(userId));
  if (!room) return { ...out, stoppedBy: `You’ve sent your ${settings.sendsPerDay || 40} emails for today. The rest go tomorrow.`, more: true };

  // Out-of-office pauses that have run out: back in the queue.
  await Enrollment.updateMany({ userId, status: 'paused', pausedUntil: { $lte: now } }, { $set: { status: 'active', pausedUntil: null, nextAt: now } });

  const seqs = await Sequence.find({ userId, active: true }).lean();
  const seqBy = new Map(seqs.map(s => [String(s._id), s]));
  if (!seqs.length) return out;

  // New people started today, per sequence, against each sequence's own limit.
  const startedToday = await SentEmail.aggregate([
    { $match: { userId: seqs[0].userId, kind: 'sequence', step: 0, sentAt: { $gt: new Date(now - DAY) } } },
    { $group: { _id: '$sequenceId', n: { $sum: 1 } } },
  ]);
  const newLeft = new Map(seqs.map(s => [String(s._id), s.newPerDay]));
  for (const r of startedToday) if (newLeft.has(String(r._id))) newLeft.set(String(r._id), Math.max(0, newLeft.get(String(r._id)) - r.n));

  const due = await Enrollment.find({
    userId, status: 'active', nextAt: { $lte: now }, sequenceId: { $in: seqs.map(s => s._id) },
    // "Send selected": just these.
    ...(only ? { _id: { $in: only } } : {}),
    $or: [{ sendingUntil: null }, { sendingUntil: { $lt: now } }],
  }).sort({ nextAt: 1 }).limit(max * 4).lean();
  if (!due.length) return out;

  const [leads, profile, blocked] = await Promise.all([
    Lead.find({ userId, _id: { $in: due.map(e => e.leadId) } }).lean(),
    Profile.findOne({ userId }).lean(),
    loadBlocklistSets(userId),
  ]);
  const leadBy = new Map(leads.map(l => [String(l._id), l]));
  const transport = mailer.transport(sender);
  const fromHeader = sender.name ? `"${sender.name.replace(/"/g, '')}" <${sender.email}>` : sender.email;

  for (const e of due) {
    if (out.sent >= max || room <= 0 || Date.now() - started > budgetMs) { out.more = true; break; }
    const seq = seqBy.get(String(e.sequenceId));
    const lead = leadBy.get(String(e.leadId));
    const step = seq && seq.steps[e.step];
    const name = lead ? lead.name : 'A lead';
    const stopIt = (reason) => Enrollment.updateOne({ _id: e._id, status: 'active' }, { $set: { status: 'stopped', stopReason: reason, sendingUntil: null } });

    if (!lead) { await stopIt('manual'); continue; }
    if (!step) { await Enrollment.updateOne({ _id: e._id }, { $set: { status: 'done' } }); continue; }
    if (step.kind === 'task') continue;                         // waits for the user (Outreach page)
    if (lead.status === 'replied') { await stopIt('replied'); continue; }
    if (lead.status !== 'in-sequence') { await stopIt('manual'); continue; }
    if (isBlocked(e.email, blocked)) { await stopIt('unsubscribed'); out.skipped.push({ name, reason: 'On your blocklist' }); continue; }
    if (e.step === 0 && !(newLeft.get(String(seq._id)) > 0)) { out.more = true; continue; }
    // One email per address per day, whatever sent it.
    const recent = await SentEmail.exists({ userId, to: e.email, sentAt: { $gt: new Date(now - DAY + 60_000) } });
    if (recent) { out.skipped.push({ name, reason: 'Emailed in the last day — tomorrow' }); continue; }

    // Your edited wording for this step wins over the sequence's.
    const edited = e.edits && e.edits.step === e.step ? e.edits : null;
    const r = edited ? { ok: true, subject: edited.subject, body: edited.body }
      : renderStep(e.step === 0 ? step : { ...step, subject: '' }, lead, profile || {}, settings);
    if (!r.ok) {
      const why = whyBlocked(r);
      await Enrollment.updateOne({ _id: e._id }, { $set: { lastError: `Not sent: ${why}` } });
      out.skipped.push({ name, reason: why });
      continue;
    }

    // Claim. Only one sender gets past this for this enrolment at this step.
    const claimed = await Enrollment.findOneAndUpdate(
      { _id: e._id, status: 'active', step: e.step, $or: [{ sendingUntil: null }, { sendingUntil: { $lt: new Date() } }] },
      { $set: { sendingUntil: new Date(Date.now() + CLAIM_MS) } },
      { returnDocument: 'after' },
    ).lean();
    if (!claimed) continue;

    const subject = e.step === 0 ? r.subject : `Re: ${claimed.threadSubject}`;
    const unsub = unsubscribeUrl(userId, lead._id, e.email);
    const text = r.body;
    const thread = e.step > 0 && claimed.lastMessageId
      ? { inReplyTo: claimed.lastMessageId, references: [claimed.firstMessageId, claimed.lastMessageId].filter((v, i, a) => v && a.indexOf(v) === i) }
      : {};
    let info;
    try {
      info = await transport.sendMail({
        from: fromHeader, to: e.email, subject, text, html: toHtml(text), ...thread,
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    } catch (err) {
      await Enrollment.updateOne({ _id: e._id }, { $set: { sendingUntil: null, lastError: String(err.message || err).slice(0, 300) } });
      if (mailer.isQuotaError(err)) {
        const until = new Date(Date.now() + PAUSE_MS);
        await Settings.updateOne({ userId }, { $set: { sendingPausedUntil: until } });
        return { ...out, stoppedBy: 'Gmail’s daily sending limit was reached. Sending waits an hour; nothing is lost.', pausedUntil: until };
      }
      if (mailer.isAuthError(err)) return { ...out, stoppedBy: 'Gmail refused the login — the app password may have been revoked. Reconnect Gmail in Free connections.' };
      out.skipped.push({ name, reason: `Gmail error: ${String(err.message || err).slice(0, 120)}` });
      continue;
    }

    if (mailer.dryRun()) {
      const m = JSON.parse(String(info.message || '{}'));
      console.log(`[outreach dry-run] ${JSON.stringify({ to: e.email, subject, inReplyTo: m.inReplyTo, references: m.references, headers: m.headers })}`);
    }
    // In dry-run the JSON transport makes no Message-ID header of its own.
    const messageId = info.messageId || `<dryrun-${e._id}-${e.step}-${Date.now()}@clientline.local>`;
    await SentEmail.create({
      userId, leadId: lead._id, enrollmentId: e._id, sequenceId: seq._id, kind: 'sequence', step: e.step,
      from: sender.email, to: e.email, subject, text: r.body, messageId,
      meta: e.step === 0 && step.useLeadEmail && lead.firstEmail ? {
        shape: lead.firstEmail.shape, caseTitle: lead.firstEmail.caseTitle,
        words: (r.body.match(/\S+/g) || []).length, edited: !!edited || lead.firstEmail.state === 'edited',
      } : null,
    });
    const next = seq.steps[e.step + 1];
    await Enrollment.updateOne({ _id: e._id }, {
      $set: {
        step: e.step + 1,
        ...(e.step === 0 ? { firstMessageId: messageId } : {}),
        lastMessageId: messageId,
        // Spaced from when this one actually went, so a late press doesn't bunch them up.
        nextAt: next ? new Date(Date.now() + Math.max(1, next.dayOffset - step.dayOffset) * DAY) : new Date(),
        status: next ? 'active' : 'done',
        sendingUntil: null, lastError: null, edits: null,
      },
    });
    out.sent++; room--;
    out.last = { name, email: e.email };
    if (e.step === 0) newLeft.set(String(seq._id), newLeft.get(String(seq._id)) - 1);
  }
  return out;
}

/** A task step ("connect on LinkedIn") the user has done: move on to the next step. */
async function completeTask(userId, enrollmentId) {
  const e = await Enrollment.findOne({ _id: enrollmentId, userId, status: 'active' }).lean();
  if (!e) return false;
  const seq = await Sequence.findOne({ _id: e.sequenceId, userId }).lean();
  const step = seq && seq.steps[e.step];
  if (!step || step.kind !== 'task') return false;
  const next = seq.steps[e.step + 1];
  await Enrollment.updateOne({ _id: e._id, step: e.step }, { $set: {
    step: e.step + 1, status: next ? 'active' : 'done',
    nextAt: next ? new Date(Date.now() + Math.max(1, next.dayOffset - step.dayOffset) * DAY) : new Date(),
  } });
  return true;
}

module.exports = { sendDue, dueSummary, completeTask, toHtml };
