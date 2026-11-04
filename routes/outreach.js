/**
 * Outreach: sequences (list with stats, create, edit, pause, delete, preview).
 * Enrolment and sending are added to this router in later slices. Every query is
 * scoped to req.userId.
 */
const express = require('express');
const mongoose = require('mongoose');
const Sequence = require('../models/Sequence');
const Enrollment = require('../models/Enrollment');
const SentEmail = require('../models/SentEmail');
const Lead = require('../models/Lead');
const Profile = require('../models/Profile');
const Settings = require('../models/Settings');
const { renderStep, whyBlocked, variablesIn, VARIABLES, STARTER } = require('../lib/outreach/render');
const { enroll, stop, forLead } = require('../lib/outreach/enroll');
const { sendDue, dueSummary, completeTask } = require('../lib/outreach/send');
const { checkMailbox } = require('../lib/mailbox/scan');

const router = express.Router();
const validId = (id) => mongoose.isValidObjectId(id);

/** Cleaned steps, or an error string. */
function cleanSteps(raw) {
  const steps = (Array.isArray(raw) ? raw : []).slice(0, Sequence.MAX_STEPS).map((s, i) => ({
    kind: s && s.kind === 'task' && i > 0 ? 'task' : 'email',
    dayOffset: Math.max(0, Math.min(60, Math.round(Number(s && s.dayOffset) || 0))),
    subject: String((s && s.subject) || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    body: String((s && s.body) || '').replace(/\r\n?/g, '\n').trim().slice(0, 4000),
  }));
  if (!steps.length) return { error: 'A sequence needs at least one email.' };
  steps[0].dayOffset = 0;
  if (!steps[0].subject) return { error: 'The first email needs a subject.' };
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].body) return { error: `Step ${i + 1} is empty.` };
    if (i > 0 && steps[i].dayOffset <= steps[i - 1].dayOffset) return { error: `Step ${i + 1} must come at least a day after step ${i}.` };
    const { unknown } = variablesIn(`${steps[i].subject}\n${steps[i].body}`);
    if (unknown.length) return { error: `Step ${i + 1} uses ${unknown.map(k => `{{${k}}}`).join(', ')}, which isn't a variable.` };
  }
  return { steps };
}

/** Per-sequence numbers for the cards: people, per-step sent/replied, stops. */
async function statsFor(userId, ids) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const [byStatus, byStep, replied] = await Promise.all([
    Enrollment.aggregate([{ $match: { userId: uid, sequenceId: { $in: ids } } },
      { $group: { _id: { s: '$sequenceId', status: '$status', reason: '$stopReason' }, n: { $sum: 1 } } }]),
    SentEmail.aggregate([{ $match: { userId: uid, kind: 'sequence' } },
      { $lookup: { from: 'enrollments', localField: 'enrollmentId', foreignField: '_id', as: 'e' } },
      { $unwind: '$e' }, { $match: { 'e.sequenceId': { $in: ids } } },
      { $group: { _id: { s: '$e.sequenceId', step: '$step' }, n: { $sum: 1 } } }]),
    // A reply counts against the last step sent before it stopped the sequence.
    Enrollment.aggregate([{ $match: { userId: uid, sequenceId: { $in: ids }, stopReason: 'replied' } },
      { $group: { _id: { s: '$sequenceId', step: { $max: [0, { $subtract: ['$step', 1] }] } }, n: { $sum: 1 } } }]),
  ]);
  const out = {};
  for (const id of ids) out[String(id)] = { people: 0, active: 0, done: 0, replied: 0, bounced: 0, unsubscribed: 0, sent: {}, repliedAt: {} };
  for (const r of byStatus) {
    const o = out[String(r._id.s)]; if (!o) continue;
    o.people += r.n;
    if (r._id.status === 'active' || r._id.status === 'paused') o.active += r.n;
    if (r._id.status === 'done') o.done += r.n;
    if (r._id.reason === 'replied') o.replied += r.n;
    if (r._id.reason === 'bounced') o.bounced += r.n;
    if (r._id.reason === 'unsubscribed') o.unsubscribed += r.n;
  }
  for (const r of byStep) { const o = out[String(r._id.s)]; if (o) o.sent[r._id.step] = r.n; }
  for (const r of replied) { const o = out[String(r._id.s)]; if (o) o.repliedAt[r._id.step] = r.n; }
  return out;
}

const view = (s, stats) => ({
  id: String(s._id), name: s.name, active: s.active, newPerDay: s.newPerDay, steps: s.steps,
  createdAt: s.createdAt, stats: stats || null,
});

router.get('/sequences', async (req, res) => {
  try {
    let seqs = await Sequence.find({ userId: req.userId }).sort({ createdAt: 1 }).lean();
    // Every account starts with one ready-made sequence.
    if (!seqs.length) seqs = [(await Sequence.create({ userId: req.userId, ...STARTER })).toObject()];
    const stats = await statsFor(req.userId, seqs.map(s => s._id));
    res.json({ sequences: seqs.map(s => view(s, stats[String(s._id)])), variables: VARIABLES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sequences', async (req, res) => {
  try {
    const count = await Sequence.countDocuments({ userId: req.userId });
    if (count >= 20) return res.status(400).json({ error: 'You can have up to 20 sequences.' });
    const name = String((req.body && req.body.name) || '').trim().slice(0, 80) || `Sequence ${count + 1}`;
    const seq = await Sequence.create({ userId: req.userId, name, active: false, steps: STARTER.steps });
    res.status(201).json(view(seq.toObject()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/sequences/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such sequence' });
  const b = req.body || {};
  const $set = {};
  if (typeof b.name === 'string') {
    const name = b.name.trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Give the sequence a name.' });
    $set.name = name;
  }
  if (b.newPerDay !== undefined) $set.newPerDay = Math.min(100, Math.max(1, Math.round(Number(b.newPerDay) || 15)));
  if (typeof b.active === 'boolean') $set.active = b.active;
  if (b.steps !== undefined) {
    const r = cleanSteps(b.steps);
    if (r.error) return res.status(400).json({ error: r.error });
    $set.steps = r.steps;
  }
  try {
    const seq = await Sequence.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set }, { returnDocument: 'after' }).lean();
    if (!seq) return res.status(404).json({ error: 'No such sequence' });
    // Shortened: anyone now past the last step is finished.
    if ($set.steps) {
      await Enrollment.updateMany({ userId: req.userId, sequenceId: seq._id, status: { $in: ['active', 'paused'] }, step: { $gte: seq.steps.length } },
        { $set: { status: 'done' } });
    }
    const stats = await statsFor(req.userId, [seq._id]);
    res.json(view(seq, stats[String(seq._id)]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sequences/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such sequence' });
  try {
    const active = await Enrollment.countDocuments({ userId: req.userId, sequenceId: req.params.id, status: { $in: ['active', 'paused'] } });
    if (active) return res.status(409).json({ error: `${active} ${active === 1 ? 'person is' : 'people are'} still in this sequence. Pause it, or stop them first.` });
    const r = await Sequence.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!r.deletedCount) return res.status(404).json({ error: 'No such sequence' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Every step of a (possibly unsaved) sequence rendered for one lead — the one
 * asked for, else your best new or approved lead with an email.
 */
router.post('/sequences/preview', async (req, res) => {
  const r = cleanSteps(req.body && req.body.steps);
  if (r.error) return res.status(400).json({ error: r.error });
  try {
    const q = { userId: req.userId };
    if (req.body.leadId && validId(req.body.leadId)) q._id = req.body.leadId;
    else Object.assign(q, { email: { $ne: null }, status: { $in: ['approved', 'new'] } });
    const [lead, profile, settings] = await Promise.all([
      Lead.findOne(q).sort({ status: 1, fit: -1 }).lean(),
      Profile.findOne({ userId: req.userId }).lean(),
      Settings.findOne({ userId: req.userId }, { senderName: 1, bookingUrl: 1 }).lean(),
    ]);
    const sample = lead || { name: 'Acme', person: 'Ritika Sharma', opener: 'Saw your post about rebuilding the customer app — that’s the kind of work I do.', service: '' };
    const steps = r.steps.map((s, i) => {
      const step = i > 0 ? { ...s, subject: '' } : s;
      const out = renderStep(step, sample, profile || {}, settings || {});
      return out.ok ? { ok: true, subject: i > 0 ? null : out.subject, body: out.body } : { ok: false, why: whyBlocked(out) };
    });
    res.json({ lead: lead ? { id: String(lead._id), name: lead.name, person: lead.person } : null, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Enrolment ───────────────────────────────────────────────────────────────

/** Add leads to a sequence. Each one that can't go in comes back with the reason. */
router.post('/enroll', async (req, res) => {
  const { leadIds, sequenceId } = req.body || {};
  const ids = (Array.isArray(leadIds) ? leadIds : []).filter(validId).slice(0, 200);
  if (!ids.length || !validId(sequenceId)) return res.status(400).json({ error: 'Pick leads and a sequence.' });
  try {
    const r = await enroll(req.userId, ids, sequenceId);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.leadIds) ? req.body.leadIds : []).filter(validId).slice(0, 200);
  if (!ids.length) return res.status(400).json({ error: 'Pick leads to stop.' });
  try {
    res.json({ ok: true, stopped: await stop(req.userId, ids, 'manual') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** One lead's sequence, for the drawer. */
router.get('/lead/:leadId', async (req, res) => {
  if (!validId(req.params.leadId)) return res.status(404).json({ error: 'No such lead' });
  try {
    res.json({ enrollment: await forLead(req.userId, req.params.leadId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sending (manual: the user presses "Send due emails") ────────────────────

router.get('/due', async (req, res) => {
  try {
    res.json(await dueSummary(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Your own wording for one lead's next email (subject only for a first email —
 * a follow-up keeps the thread's "Re:" subject). `reset: true` goes back to the
 * sequence's text.
 */
router.put('/due/:enrollmentId', async (req, res) => {
  if (!validId(req.params.enrollmentId)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  try {
    const e = await Enrollment.findOne({ _id: req.params.enrollmentId, userId: req.userId, status: 'active' }, { step: 1 }).lean();
    if (!e) return res.status(404).json({ error: 'That email is no longer due.' });
    if (b.reset) {
      await Enrollment.updateOne({ _id: e._id }, { $set: { edits: null } });
    } else {
      const subject = String(b.subject || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const body = String(b.body || '').replace(/\r\n?/g, '\n').trim().slice(0, 4000);
      if (!body) return res.status(400).json({ error: 'The email is empty.' });
      if (e.step === 0 && !subject) return res.status(400).json({ error: 'The first email needs a subject.' });
      if (/\{\{|\}\}/.test(`${subject} ${body}`)) return res.status(400).json({ error: 'Replace the {{variables}} with real words — this is the final email.' });
      await Enrollment.updateOne({ _id: e._id }, { $set: { edits: { step: e.step, subject, body } } });
    }
    res.json(await dueSummary(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Take one lead out of its sequence from the due list: nothing more is sent; the lead goes back to Approved. */
router.post('/due/:enrollmentId/remove', async (req, res) => {
  if (!validId(req.params.enrollmentId)) return res.status(404).json({ error: 'Not found' });
  try {
    const e = await Enrollment.findOne({ _id: req.params.enrollmentId, userId: req.userId }, { leadId: 1 }).lean();
    if (!e) return res.status(404).json({ error: 'Not found' });
    await stop(req.userId, [e.leadId], 'manual');
    res.json(await dueSummary(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** One batch, sized to finish inside a request. The page calls again while `more` is true. */
router.post('/send', async (req, res) => {
  const only = Array.isArray(req.body && req.body.only) ? req.body.only.filter(validId).slice(0, 200) : null;
  try {
    // Replies first, so nobody who answered gets a follow-up. At most every two minutes,
    // since the page sends batch after batch.
    const mail = await checkMailbox(req.userId, { minIntervalMs: 2 * 60 * 1000, budgetMs: 15_000 }).catch(err => ({ ok: false, error: err.message }));
    const r = await sendDue(req.userId, { only: only && only.length ? only : null });
    res.json({ ...r, mailbox: mail, due: await dueSummary(req.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tasks/:enrollmentId/done', async (req, res) => {
  if (!validId(req.params.enrollmentId)) return res.status(404).json({ error: 'No such task' });
  try {
    const ok = await completeTask(req.userId, req.params.enrollmentId);
    if (!ok) return res.status(404).json({ error: 'That task is already done or gone.' });
    res.json({ ok: true, due: await dueSummary(req.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.cleanSteps = cleanSteps;
