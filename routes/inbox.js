/**
 * Inbox: replies to outreach. Lists (Needs you · Snoozed · All), a thread, snooze,
 * done, re-sort by hand, an AI draft, and sending an answer in the same Gmail
 * thread. Every query is scoped to req.userId.
 */
const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const SentEmail = require('../models/SentEmail');
const Lead = require('../models/Lead');
const Enrollment = require('../models/Enrollment');
const Settings = require('../models/Settings');
const mailer = require('../lib/mailer');
const { checkMailbox } = require('../lib/mailbox/scan');
const { draftReply, gapsIn } = require('../lib/inbox/draft');
const { CATEGORIES, needsYouFor } = require('../lib/inbox/classify');
const { toHtml } = require('../lib/outreach/send');

const router = express.Router();
const validId = (id) => mongoose.isValidObjectId(id);
const VIEWS = { sent: null, needs: { needsYou: true }, snoozed: { snoozedUntil: { $ne: null } }, all: {} };
const DAY_FMT = { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' };

/**
 * Where an emailed person stands, for the Sent view: replied, waiting on the next
 * follow-up, paused by an out-of-office, bounced, unsubscribed, or finished unanswered.
 */
function sentState(convo, enr) {
  if (convo && convo.lastInboundAt) return { key: 'replied', label: 'Replied' };
  if (!enr) return { key: 'sent', label: 'Sent' };
  if (enr.status === 'active') return { key: 'waiting', label: `Waiting · next email ${new Date(enr.nextAt).toLocaleDateString('en-IN', DAY_FMT)}` };
  if (enr.status === 'paused') return { key: 'waiting', label: `Out of office · resumes ${enr.pausedUntil ? new Date(enr.pausedUntil).toLocaleDateString('en-IN', DAY_FMT) : 'later'}` };
  if (enr.status === 'done') return { key: 'no-reply', label: 'No reply · sequence finished' };
  return {
    bounced: { key: 'bounced', label: 'Bounced' },
    unsubscribed: { key: 'stopped', label: 'Unsubscribed' },
    replied: { key: 'replied', label: 'Replied' },
  }[enr.stopReason] || { key: 'stopped', label: 'Sequence stopped' };
}

/** Everyone you've emailed, one thread per person, newest first (like Gmail's Sent). */
async function sentThreads(userId) {
  const rows = await SentEmail.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)), leadId: { $ne: null } } },
    { $sort: { sentAt: 1 } },
    { $group: { _id: '$leadId', to: { $last: '$to' }, subject: { $first: '$subject' }, text: { $last: '$text' }, lastAt: { $last: '$sentAt' }, count: { $sum: 1 } } },
    { $sort: { lastAt: -1 } },
    { $limit: 200 },
  ]);
  const leadIds = rows.map(r => r._id);
  const [leads, convos, enrs] = await Promise.all([
    Lead.find({ userId, _id: { $in: leadIds } }, { name: 1, person: 1 }).lean(),
    Conversation.find({ userId, leadId: { $in: leadIds } }, { leadId: 1, lastInboundAt: 1, lastAt: 1, category: 1, unread: 1 }).lean(),
    Enrollment.find({ userId, leadId: { $in: leadIds } }).sort({ enrolledAt: 1 }).lean(),
  ]);
  const lead = new Map(leads.map(l => [String(l._id), l]));
  const convo = new Map(convos.map(c => [String(c.leadId), c]));
  const enr = new Map(enrs.map(e => [String(e.leadId), e]));   // the latest one wins
  return rows.map(r => {
    const id = String(r._id); const l = lead.get(id); const c = convo.get(id);
    return {
      // A thread with a reply opens as the conversation; otherwise the sent-only thread.
      id: c ? String(c._id) : `sent-${id}`, leadId: id, email: r.to,
      name: l ? (l.person || l.name) : r.to, company: l ? l.name : '',
      category: c ? c.category : null, categoryWhy: '', needsYou: false, unread: false,
      snoozedUntil: null, doneAt: null, lastAt: c && c.lastAt > r.lastAt ? c.lastAt : r.lastAt,
      snippet: `You: ${String(r.text || r.subject || '').replace(/\s+/g, ' ').slice(0, 150)}`,
      subject: r.subject, sentCount: r.count, state: sentState(c, enr.get(id)),
    };
  });
}

/** Snoozes that have run out come back to Needs you. */
const wake = (userId) => Conversation.updateMany({ userId, snoozedUntil: { $lte: new Date() } }, { $set: { snoozedUntil: null, needsYou: true } });

const listItem = (c, lead) => {
  const lastIn = [...c.messages].reverse().find(m => m.direction === 'in');
  return {
    id: String(c._id), leadId: String(c.leadId), email: c.email,
    name: lead ? (lead.person || lead.name) : c.email, company: lead ? lead.name : '',
    category: c.category, categoryWhy: c.categoryWhy, needsYou: c.needsYou, unread: c.unread,
    snoozedUntil: c.snoozedUntil, doneAt: c.doneAt, lastAt: c.lastAt,
    snippet: lastIn ? String(lastIn.text || '').replace(/\s+/g, ' ').slice(0, 160) : '',
  };
};

router.get('/count', async (req, res) => {
  try {
    await wake(req.userId);
    res.json({ needsYou: await Conversation.countDocuments({ userId: req.userId, needsYou: true }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Check Gmail now. `?soon=1` skips it when the last check was under ten minutes ago (opening the page). */
router.post('/check', async (req, res) => {
  try {
    const r = await checkMailbox(req.userId, { minIntervalMs: req.query.soon ? 10 * 60 * 1000 : 0 });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const view = req.query.view in VIEWS ? req.query.view : 'needs';
  try {
    await wake(req.userId);
    const uid = req.userId;
    let items;
    if (view === 'sent') items = await sentThreads(uid);
    else {
      const convos = await Conversation.find({ userId: uid, ...VIEWS[view] }).sort({ lastAt: -1 }).limit(200).lean();
      const leads = await Lead.find({ userId: uid, _id: { $in: convos.map(c => c.leadId) } }, { name: 1, person: 1 }).lean();
      const by = new Map(leads.map(l => [String(l._id), l]));
      items = convos.map(c => listItem(c, by.get(String(c.leadId))));
    }
    const [needs, snoozed, all, sent, s] = await Promise.all([
      Conversation.countDocuments({ userId: uid, needsYou: true }),
      Conversation.countDocuments({ userId: uid, snoozedUntil: { $ne: null } }),
      Conversation.countDocuments({ userId: uid }),
      SentEmail.distinct('leadId', { userId: uid, leadId: { $ne: null } }).then(ids => ids.length),
      Settings.findOne({ userId: uid }, { mailbox: 1 }).lean(),
    ]);
    res.json({
      view, items,
      counts: { needs, snoozed, all, sent },
      categories: CATEGORIES,
      lastCheckAt: s && s.mailbox ? s.mailbox.lastCheckAt : null,
      lastError: s && s.mailbox ? s.mailbox.lastError : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** A thread nobody has answered yet: the emails you sent this person, oldest first. */
router.get('/sent/:leadId', async (req, res) => {
  if (!validId(req.params.leadId)) return res.status(404).json({ error: 'No such thread' });
  try {
    const uid = req.userId; const leadId = req.params.leadId;
    const [sent, lead, convo, enr] = await Promise.all([
      SentEmail.find({ userId: uid, leadId }).sort({ sentAt: 1 }).limit(50).lean(),
      Lead.findOne({ _id: leadId, userId: uid }, { name: 1, person: 1, title: 1, email: 1, service: 1 }).lean(),
      Conversation.findOne({ userId: uid, leadId }, { _id: 1, lastInboundAt: 1 }).lean(),
      Enrollment.findOne({ userId: uid, leadId }).sort({ enrolledAt: -1 }).lean(),
    ]);
    if (!sent.length) return res.status(404).json({ error: 'No such thread' });
    res.json({
      leadId, name: lead ? (lead.person || lead.name) : sent[0].to, company: lead ? lead.name : '', email: sent[sent.length - 1].to,
      subject: sent[0].subject, conversationId: convo ? String(convo._id) : null, state: sentState(convo, enr),
      messages: sent.map(m => ({ direction: 'out', from: m.from, subject: m.subject, text: m.text, messageId: m.messageId, at: m.sentAt, step: m.step, kind: m.kind })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such conversation' });
  try {
    const c = await Conversation.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set: { unread: false } }, { returnDocument: 'after' }).lean();
    if (!c) return res.status(404).json({ error: 'No such conversation' });
    const lead = await Lead.findOne({ _id: c.leadId, userId: req.userId }, { name: 1, person: 1, title: 1, email: 1, service: 1 }).lean();
    const s = await Settings.findOne({ userId: req.userId }, { bookingUrl: 1 }).lean();
    res.json({ ...listItem(c, lead), subject: c.subject, messages: c.messages, lead: lead ? { ...lead, id: String(lead._id), _id: undefined } : null, bookingUrl: (s && s.bookingUrl) || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function update(req, res, $set) {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such conversation' });
  try {
    const c = await Conversation.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set }, { returnDocument: 'after' }).lean();
    if (!c) return res.status(404).json({ error: 'No such conversation' });
    res.json({ ok: true, needsYou: c.needsYou, snoozedUntil: c.snoozedUntil, doneAt: c.doneAt, category: c.category });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.post('/:id/snooze', (req, res) => {
  const until = new Date(req.body && req.body.until);
  if (Number.isNaN(until.getTime()) || until <= new Date()) return res.status(400).json({ error: 'Pick a date in the future.' });
  if (until - Date.now() > 366 * 86400000) return res.status(400).json({ error: 'Pick a date within a year.' });
  return update(req, res, { snoozedUntil: until, needsYou: false });
});
router.post('/:id/done', (req, res) => update(req, res, { doneAt: new Date(), needsYou: false, snoozedUntil: null }));
router.post('/:id/reopen', (req, res) => update(req, res, { doneAt: null, needsYou: true, snoozedUntil: null }));
router.put('/:id/category', (req, res) => {
  const category = req.body && req.body.category;
  if (!CATEGORIES[category]) return res.status(400).json({ error: 'Unknown category' });
  return update(req, res, { category, categoryBy: 'you', categoryWhy: 'Set by you', needsYou: needsYouFor(category) });
});

router.post('/:id/draft', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such conversation' });
  try {
    const r = await draftReply(req.userId, req.params.id);
    if (!r.ok) return res.status(r.noKeys ? 400 : 422).json({ error: r.noKeys ? 'Drafts need a free Groq key — add one in Free connections.' : `No draft could be written from what’s known: ${r.error}`, code: r.noKeys ? 'AI_KEY_REQUIRED' : null });
    res.json({ text: r.text, gaps: gapsIn(r.text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send an answer from Gmail, in the same thread. Refused while a [gap] is left. */
router.post('/:id/send', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such conversation' });
  const text = String((req.body && req.body.text) || '').replace(/\r\n?/g, '\n').trim();
  if (text.length < 2) return res.status(400).json({ error: 'Write something first.' });
  if (text.length > 6000) return res.status(400).json({ error: 'That reply is too long.' });
  const gaps = gapsIn(text);
  if (gaps.length) return res.status(400).json({ error: `Fill in ${gaps.join(', ')} before sending.` });
  try {
    const c = await Conversation.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!c) return res.status(404).json({ error: 'No such conversation' });
    let sender;
    try { sender = await mailer.getSender(req.userId); } catch (err) { return res.status(400).json({ error: err.message }); }
    if (!sender) return res.status(400).json({ error: 'Connect Gmail in Free connections first.' });
    const lastIn = [...c.messages].reverse().find(m => m.direction === 'in');
    const ids = c.messages.map(m => m.messageId).filter(Boolean);
    const subject = `Re: ${String(c.subject || (lastIn && lastIn.subject) || '').replace(/^(?:re|aw|sv)\s*:\s*/i, '')}`;
    const info = await mailer.transport(sender).sendMail({
      from: sender.name ? `"${sender.name.replace(/"/g, '')}" <${sender.email}>` : sender.email,
      to: c.email, subject, text, html: toHtml(text),
      ...(lastIn && lastIn.messageId ? { inReplyTo: lastIn.messageId } : {}),
      references: ids.slice(-10),
    }).catch(err => { throw Object.assign(new Error(mailer.isAuthError(err) ? 'Gmail refused the login — reconnect Gmail in Free connections.' : mailer.isQuotaError(err) ? 'Gmail’s daily sending limit is reached. Try again later.' : `Gmail error: ${err.message}`), { status: 400 }); });
    const messageId = info.messageId || `<dryrun-reply-${c._id}-${Date.now()}@clientline.local>`;
    const at = new Date();
    await SentEmail.create({ userId: req.userId, leadId: c.leadId, conversationId: c._id, kind: 'reply', from: sender.email, to: c.email, subject, text: text.slice(0, 4000), messageId, sentAt: at });
    await Conversation.updateOne({ _id: c._id }, {
      $push: { messages: { $each: [{ direction: 'out', from: sender.email, subject, text: text.slice(0, 8000), messageId, inReplyTo: lastIn ? lastIn.messageId : null, at }], $slice: -50 } },
      $set: { needsYou: false, lastAt: at, snoozedUntil: null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
