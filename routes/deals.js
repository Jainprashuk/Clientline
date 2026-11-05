/**
 * Deals: the board (grouped by stage, with totals), one deal, start one, move it,
 * edit it, delete it. Every query is scoped to req.userId.
 */
const express = require('express');
const mongoose = require('mongoose');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');
const Profile = require('../models/Profile');
const Conversation = require('../models/Conversation');
const { createDeal, flagsForDeal } = require('../lib/deals/create');

const router = express.Router();
const validId = (id) => mongoose.isValidObjectId(id);
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

const view = (d) => ({ ...d, id: String(d._id), _id: undefined, userId: undefined, __v: undefined });

router.get('/', async (req, res) => {
  try {
    const q = { userId: req.userId };
    if (req.query.leadId && validId(req.query.leadId)) q.leadId = req.query.leadId;
    const deals = await Deal.find(q).sort({ lastActivityAt: -1 }).limit(500).lean();
    // Totals per stage and currency, in minor units.
    const totals = {};
    for (const d of deals) {
      const t = (totals[d.stage] = totals[d.stage] || {});
      t[d.currency] = (t[d.currency] || 0) + (d.value || 0);
    }
    res.json({ deals: deals.map(view), totals, stages: Deal.STAGES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such deal' });
  try {
    const d = await Deal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!d) return res.status(404).json({ error: 'No such deal' });
    const [convo, lead] = await Promise.all([
      d.conversationId ? Conversation.findOne({ _id: d.conversationId, userId: req.userId }, { messages: { $slice: -6 }, subject: 1, category: 1 }).lean() : null,
      d.leadId ? Lead.findOne({ _id: d.leadId, userId: req.userId }, { name: 1, postUrl: 1, where: 1, about: 1 }).lean() : null,
    ]);
    res.json({
      ...view(d),
      thread: convo ? { id: String(convo._id), subject: convo.subject, category: convo.category, messages: convo.messages } : null,
      lead: lead ? { id: String(lead._id), name: lead.name, postUrl: lead.postUrl, where: lead.where } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Start a deal: { leadId } or { conversationId } or by hand { name, client, email, value, currency }. */
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (b.leadId && !validId(b.leadId)) return res.status(404).json({ error: 'No such lead' });
  if (b.conversationId && !validId(b.conversationId)) return res.status(404).json({ error: 'No such conversation' });
  if (!b.leadId && !b.conversationId && !clip(b.name, 120)) return res.status(400).json({ error: 'Give the deal a name.' });
  try {
    const r = await createDeal(req.userId, b);
    if (r.error) return res.status(404).json({ error: r.error });
    res.status(r.existing ? 200 : 201).json({ ...view(r.deal), existing: r.existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such deal' });
  const b = req.body || {};
  const $set = {};
  if (typeof b.name === 'string') { if (!clip(b.name, 120)) return res.status(400).json({ error: 'A deal needs a name.' }); $set.name = clip(b.name, 120); }
  for (const k of ['client', 'person']) if (typeof b[k] === 'string') $set[k] = clip(b[k], 120);
  if (typeof b.email === 'string') $set.email = clip(b.email, 200).toLowerCase();
  if (typeof b.next === 'string') $set.next = clip(b.next, 200);
  if (typeof b.lostReason === 'string') $set.lostReason = clip(b.lostReason, 200);
  if (b.value != null) {
    const v = Number(b.value);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'The value must be a number.' });
    $set.value = Math.round(v * 100);
  }
  if (b.currency != null) {
    if (!Deal.CURRENCIES.includes(b.currency)) return res.status(400).json({ error: 'Unknown currency' });
    $set.currency = b.currency;
  }
  if (b.callNotes && typeof b.callNotes === 'object') {
    for (const [k, max] of [['budget', 300], ['timeline', 300], ['decider', 300], ['done', 600], ['other', 2000]]) {
      if (typeof b.callNotes[k] === 'string') $set[`callNotes.${k}`] = String(b.callNotes[k]).trim().slice(0, max);
    }
  }
  if (b.stage != null && !Deal.STAGES.includes(b.stage)) return res.status(400).json({ error: 'Unknown stage' });
  try {
    const d = await Deal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!d) return res.status(404).json({ error: 'No such deal' });
    const update = { $set: { ...$set, lastActivityAt: new Date() } };
    if (b.stage && b.stage !== d.stage) {
      update.$set.stage = b.stage;
      update.$push = { stageHistory: { stage: b.stage, at: new Date() } };
      if (b.stage !== 'lost') update.$set.lostReason = $set.lostReason || '';
    }
    let updated = await Deal.findOneAndUpdate({ _id: d._id, userId: req.userId }, update, { returnDocument: 'after' }).lean();
    // A new value can make (or clear) "below your minimum".
    if ($set.value != null || $set.currency) {
      const [lead, convo, profile] = await Promise.all([
        updated.leadId ? Lead.findOne({ _id: updated.leadId, userId: req.userId }).lean() : null,
        updated.conversationId ? Conversation.findOne({ _id: updated.conversationId, userId: req.userId }).lean() : null,
        Profile.findOne({ userId: req.userId }).lean(),
      ]);
      updated = await Deal.findOneAndUpdate({ _id: d._id }, { $set: { flags: flagsForDeal(updated, lead, convo, profile || {}) } }, { returnDocument: 'after' }).lean();
    }
    res.json(view(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such deal' });
  try {
    const r = await Deal.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!r.deletedCount) return res.status(404).json({ error: 'No such deal' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
