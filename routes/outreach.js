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

module.exports = router;
module.exports.cleanSteps = cleanSteps;
