/**
 * The Leads page: list, read, edit the first line, approve, discard (with a
 * reason), and undo. Every query is scoped to req.userId.
 *
 * A discard reason is required: repeated reasons are how the gates get tuned,
 * and "not my service" five times in a row says the profile's keywords are off.
 */
const express = require('express');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const { WEAK } = require('../lib/leads/score');
const { writeOpener } = require('../lib/leads/opener');
const { writeFirstEmail, emailStrength } = require('../lib/outreach/firstEmail');
const { rankCases } = require('../lib/outreach/cases');
const Profile = require('../models/Profile');
const Enrollment = require('../models/Enrollment');
const Sequence = require('../models/Sequence');

const { STATUSES, SOURCES, DISCARD_REASONS } = Lead;
const router = express.Router();

const MAX_LIMIT = 100;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validId = (id) => mongoose.isValidObjectId(id);

const LIST_FIELDS = {
  name: 1, person: 1, title: 1, email: 1, emailConfidence: 1, source: 1, sourceType: 1, where: 1, postedAt: 1,
  fit: 1, fitWhy: 1, status: 1, heldReason: 1, discardReason: 1, service: 1, createdAt: 1, opener: 1, openerState: 1, 'firstEmail.state': 1,
  signals: { $slice: 1 },
};

const shape = (l) => ({ ...l, id: String(l._id), _id: undefined, userId: undefined, __v: undefined, dedupeKey: undefined, runId: undefined });

router.get('/', async (req, res) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : 'new';
    const filter = { userId: req.userId, status };
    if (SOURCES.includes(req.query.source)) filter.source = req.query.source;
    const minFit = Number(req.query.minFit);
    if (req.query.hideWeak === '1') filter.fit = { $gte: WEAK };
    else if (Number.isFinite(minFit) && minFit > 0) filter.fit = { $gte: minFit };
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q) {
      const re = new RegExp(escape(q), 'i');
      filter.$or = [{ name: re }, { person: re }, { email: re }, { about: re }];
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);

    const userId = new mongoose.Types.ObjectId(String(req.userId));
    const [leads, total, counts, weak] = await Promise.all([
      Lead.find(filter, LIST_FIELDS).sort({ fit: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Lead.countDocuments(filter),
      Lead.aggregate([{ $match: { userId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Lead.countDocuments({ userId: req.userId, status, fit: { $lt: WEAK } }),
    ]);
    // In outreach: which sequence, which step, when the next email goes.
    if (status === 'in-sequence' || status === 'replied') {
      const ens = await Enrollment.find({ userId: req.userId, leadId: { $in: leads.map(l => l._id) } }).sort({ enrolledAt: -1 }).lean();
      const seqs = await Sequence.find({ userId: req.userId, _id: { $in: [...new Set(ens.map(e => String(e.sequenceId)))] } }, { name: 1, steps: 1 }).lean();
      const seqBy = Object.fromEntries(seqs.map(s => [String(s._id), s]));
      const enBy = {};
      for (const e of ens) if (!enBy[String(e.leadId)]) enBy[String(e.leadId)] = e;
      for (const l of leads) {
        const e = enBy[String(l._id)];
        const s = e && seqBy[String(e.sequenceId)];
        if (e) l.outreach = { sequence: s ? s.name : '', step: e.step, steps: s ? s.steps.length : 0, nextAt: e.nextAt, status: e.status, stopReason: e.stopReason };
      }
    }
    res.json({
      leads: leads.map(shape),
      total, page, limit, pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(STATUSES.map(s => [s, (counts.find(c => c._id === s) || {}).n || 0])),
      weakHidden: req.query.hideWeak === '1' ? weak : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such lead' });
  try {
    const lead = await Lead.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!lead) return res.status(404).json({ error: 'No such lead' });
    res.json({ ...shape(lead), emailHelp: await emailHelp(req.userId, lead) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * For the drawer's First email: the work it could cite (best match first, then the
 * rest), and what would make it stronger.
 */
async function emailHelp(userId, lead) {
  const profile = (await Profile.findOne({ userId }).lean()) || {};
  const ranked = rankCases(profile, lead).map(c => c.title);
  const rest = (profile.cases || []).map(c => c.title).filter(t => !ranked.includes(t));
  return {
    cases: [...ranked, ...rest],
    matching: ranked.length,
    // No work for this lead's service: the email goes without proof.
    missingCaseFor: lead.service && !ranked.length ? lead.service : null,
    strength: emailStrength(profile).filter(x => !x.ok && !x.key.startsWith('case:')).map(x => x.label),
  };
}

/** The user's own edit of the first line or the first email. Their words, so no validator. */
router.patch('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such lead' });
  const body = req.body || {};
  const $set = {};
  if (typeof body.opener === 'string') {
    const opener = body.opener.replace(/\s+/g, ' ').trim().slice(0, 600);
    Object.assign($set, { opener, openerState: opener ? 'edited' : 'none', openerError: null });
  }
  if (body.firstEmail && typeof body.firstEmail === 'object') {
    const subject = String(body.firstEmail.subject || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const text = String(body.firstEmail.body || '').replace(/\r\n?/g, '\n').trim().slice(0, 4000);
    if (!subject || !text) return res.status(400).json({ error: 'The email needs a subject and a body.' });
    if (/\{\{|\}\}/.test(`${subject}${text}`)) return res.status(400).json({ error: 'Remove the {{ }} — this email is sent as written.' });
    Object.assign($set, { 'firstEmail.subject': subject, 'firstEmail.body': text, 'firstEmail.state': 'edited', 'firstEmail.error': null });
  }
  if (!Object.keys($set).length) return res.status(400).json({ error: 'Nothing to change' });
  try {
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set },
      { returnDocument: 'after' },
    ).lean();
    if (!lead) return res.status(404).json({ error: 'No such lead' });
    res.json(shape(lead));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function decide(userId, ids, action, reason) {
  if (action === 'approve') {
    return Lead.updateMany({ _id: { $in: ids }, userId, status: { $in: ['new', 'held'] } },
      { $set: { status: 'approved', decidedAt: new Date(), discardReason: null } });
  }
  if (action === 'discard') {
    // Discarding someone mid-sequence stops their emails too.
    await Enrollment.updateMany({ userId, leadId: { $in: ids }, status: { $in: ['active', 'paused'] } },
      { $set: { status: 'stopped', stopReason: 'manual', sendingUntil: null } });
    return Lead.updateMany({ _id: { $in: ids }, userId, status: { $ne: 'discarded' } },
      { $set: { status: 'discarded', discardReason: reason, decidedAt: new Date() } });
  }
  // restore: back to where it was before the decision — held if it still has no email.
  const back = await Lead.updateMany({ _id: { $in: ids }, userId, status: { $in: ['approved', 'discarded'] }, email: { $ne: null } },
    { $set: { status: 'new', discardReason: null, decidedAt: null } });
  const held = await Lead.updateMany({ _id: { $in: ids }, userId, status: { $in: ['approved', 'discarded'] }, email: null },
    { $set: { status: 'held', discardReason: null, decidedAt: null } });
  return { modifiedCount: back.modifiedCount + held.modifiedCount };
}

const ACTIONS = ['approve', 'discard', 'restore'];

router.post('/bulk', async (req, res) => {
  const { ids, action, reason } = req.body || {};
  const list = (Array.isArray(ids) ? ids : []).filter(validId).slice(0, 500);
  if (!list.length || !ACTIONS.includes(action)) return res.status(400).json({ error: 'Pick some leads and an action' });
  if (action === 'discard' && !DISCARD_REASONS.includes(reason)) return res.status(400).json({ error: 'Pick a reason for discarding' });
  try {
    const r = await decide(req.userId, list, action, reason);
    res.json({ ok: true, changed: r.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Write (or rewrite) the first line now, on the user's own AI key. */
router.post('/:id/opener', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such lead' });
  try {
    const r = await writeOpener(req.userId, req.params.id);
    if (!r.lead) return res.status(404).json({ error: 'No such lead' });
    if (r.noKeys) return res.status(400).json({ error: r.error, code: 'AI_KEY_REQUIRED' });
    res.json({ ...shape(r.lead), ok: r.ok, writeError: r.ok ? null : r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Write (or rewrite) the whole first email now. `useCase`: cite this piece of work instead. */
router.post('/:id/first-email', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such lead' });
  const useCase = typeof (req.body && req.body.useCase) === 'string' ? req.body.useCase.slice(0, 120) : null;
  try {
    const r = await writeFirstEmail(req.userId, req.params.id, { useCase });
    if (!r.lead) return res.status(404).json({ error: 'No such lead' });
    if (r.noKeys) return res.status(400).json({ error: r.error, code: 'AI_KEY_REQUIRED' });
    res.json({ ...shape(r.lead), emailHelp: await emailHelp(req.userId, r.lead), ok: r.ok, writeError: r.ok ? null : r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (!validId(id)) return res.status(404).json({ error: 'No such lead' });
  if (!ACTIONS.includes(action)) return res.status(404).json({ error: 'Not found' });
  const reason = req.body && req.body.reason;
  if (action === 'discard' && !DISCARD_REASONS.includes(reason)) return res.status(400).json({ error: 'Pick a reason for discarding' });
  try {
    await decide(req.userId, [id], action, reason);
    const lead = await Lead.findOne({ _id: id, userId: req.userId }).lean();
    if (!lead) return res.status(404).json({ error: 'No such lead' });
    res.json(shape(lead));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
