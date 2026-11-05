/**
 * Projects: every won deal while the work happens (Won → In progress → Delivered,
 * and recently Paid). One project: checklist, payments, dates, links, notes, and
 * progress updates sent in the client's thread. Scoped to req.userId.
 */
const express = require('express');
const mongoose = require('mongoose');
const Deal = require('../models/Deal');
const Proposal = require('../models/Proposal');
const Profile = require('../models/Profile');
const Settings = require('../models/Settings');
const { contextFor, ensureSeeded, paymentsFor, healthOf, nextPayment, PROJECT_STAGES } = require('../lib/projects/project');
const { updateText } = require('../lib/projects/update');
const { createInvoice, nextAfterPayment } = require('../lib/invoices/create');
const { splitAmounts } = require('../lib/invoices/math');
const { sendInThread } = require('../lib/inbox/sendInThread');

const router = express.Router();
const validId = (id) => mongoose.isValidObjectId(id);
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const RECENT_PAID = 30 * 86400000;

async function full(userId, dealDoc) {
  const ctx = await contextFor(userId, dealDoc);
  const deal = await ensureSeeded(userId, dealDoc, ctx);
  const payments = paymentsFor(ctx.proposal, ctx.invoices);
  const option = ctx.proposal && ctx.proposal.acceptedBy ? ctx.proposal.options[ctx.proposal.acceptedBy.option] : null;
  return {
    id: String(deal._id), name: deal.name, client: deal.client, person: deal.person, email: deal.email,
    stage: deal.stage, value: deal.value, currency: deal.currency, next: deal.next, conversationId: deal.conversationId ? String(deal.conversationId) : null,
    // Deals from before projects existed have no lists yet: always send them.
    project: {
      started: !!(deal.project && deal.project.started), startedAt: (deal.project && deal.project.startedAt) || null, targetAt: (deal.project && deal.project.targetAt) || null,
      tasks: ((deal.project || {}).tasks || []).map(t => ({ ...t, id: String(t._id), _id: undefined })),
      notes: ((deal.project || {}).notes || []).map(n => ({ ...n, id: String(n._id), _id: undefined })),
      links: (deal.project || {}).links || [],
      updates: (deal.project || {}).updates || [],
    },
    health: healthOf(deal), payments, nextPayment: nextPayment(payments),
    proposal: ctx.proposal ? { id: String(ctx.proposal._id), title: ctx.proposal.title, option: option ? option.name : null, weeks: option ? option.weeks : null } : null,
    paid: ctx.invoices.filter(i => i.status === 'paid').reduce((a, i) => a + i.subtotal, 0),
  };
}

router.get('/', async (req, res) => {
  try {
    const deals = await Deal.find({
      userId: req.userId,
      $or: [{ stage: { $in: PROJECT_STAGES } }, { stage: 'paid', lastActivityAt: { $gt: new Date(Date.now() - RECENT_PAID) } }],
    }).sort({ lastActivityAt: -1 }).limit(200).lean();
    const list = [];
    for (const d of deals) list.push(await full(req.userId, d));
    res.json({ projects: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function load(req, res) {
  if (!validId(req.params.id)) { res.status(404).json({ error: 'No such project' }); return null; }
  const d = await Deal.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!d) { res.status(404).json({ error: 'No such project' }); return null; }
  return d;
}

router.get('/:id', async (req, res) => {
  try { const d = await load(req, res); if (d) res.json(await full(req.userId, d)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * Changes, one kind per call:
 *  { task: { text } } add · { task: { id, done } } tick · { task: { id, text } } edit · { task: { id, remove: true } }
 *  { link: { label, url } } add · { link: { index, remove: true } }
 *  { note: { text } } add · { note: { id, remove: true } }
 *  { dates: { startedAt?, targetAt? } } · { stage: 'progress' | 'delivered' }
 */
router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const d = await load(req, res); if (!d) return;
    const q = { _id: d._id, userId: req.userId };
    const now = new Date();
    if (b.task) {
      const t = b.task;
      if (!t.id) {
        const text = clean(t.text, 300);
        if (!text) return res.status(400).json({ error: 'Write the task first.' });
        await Deal.updateOne(q, { $push: { 'project.tasks': { text, done: false, fromProposal: false } } });
      } else if (!validId(t.id)) return res.status(404).json({ error: 'No such task' });
      else if (t.remove) await Deal.updateOne(q, { $pull: { 'project.tasks': { _id: t.id } } });
      else if (typeof t.done === 'boolean') await Deal.updateOne({ ...q, 'project.tasks._id': t.id }, { $set: { 'project.tasks.$.done': t.done, 'project.tasks.$.doneAt': t.done ? now : null } });
      else if (typeof t.text === 'string' && clean(t.text, 300)) await Deal.updateOne({ ...q, 'project.tasks._id': t.id }, { $set: { 'project.tasks.$.text': clean(t.text, 300) } });
      // Ticking the first task means the work has started.
      if (t.done === true && d.stage === 'won') await Deal.updateOne(q, { $set: { stage: 'progress' }, $push: { stageHistory: { stage: 'progress', at: now } } });
    } else if (b.link) {
      if (b.link.remove) await Deal.updateOne(q, { $unset: { [`project.links.${Number(b.link.index)}`]: 1 } }).then(() => Deal.updateOne(q, { $pull: { 'project.links': null } }));
      else {
        const url = clean(b.link.url, 500);
        if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'Paste a full link (https://…).' });
        await Deal.updateOne(q, { $push: { 'project.links': { label: clean(b.link.label, 80) || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url } } });
      }
    } else if (b.note) {
      if (b.note.remove && validId(b.note.id)) await Deal.updateOne(q, { $pull: { 'project.notes': { _id: b.note.id } } });
      else {
        const text = String(b.note.text || '').trim().slice(0, 2000);
        if (!text) return res.status(400).json({ error: 'Write the note first.' });
        await Deal.updateOne(q, { $push: { 'project.notes': { text, at: now } } });
      }
    } else if (b.dates) {
      const set = {};
      for (const k of ['startedAt', 'targetAt']) {
        if (b.dates[k] === null) set[`project.${k}`] = null;
        else if (b.dates[k]) { const x = new Date(b.dates[k]); if (Number.isNaN(x.getTime())) return res.status(400).json({ error: 'Pick a date.' }); set[`project.${k}`] = x; }
      }
      await Deal.updateOne(q, { $set: set });
    } else if (['progress', 'delivered'].includes(b.stage)) {
      if (b.stage !== d.stage) {
        await Deal.updateOne(q, { $set: { stage: b.stage }, $push: { stageHistory: { stage: b.stage, at: now } } });
        await nextAfterPayment(req.userId, d._id);
      }
    } else return res.status(400).json({ error: 'Nothing to change' });
    await Deal.updateOne(q, { $set: { lastActivityAt: now } });
    res.json(await full(req.userId, await Deal.findOne(q).lean()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Draft the invoice for one part of the split (the timeline's "Create invoice"). */
router.post('/:id/payments/:part', async (req, res) => {
  try {
    const d = await load(req, res); if (!d) return;
    const proposal = await Proposal.findOne({ userId: req.userId, dealId: d._id, status: 'accepted' }).sort({ updatedAt: -1 }).lean();
    if (!proposal) return res.status(400).json({ error: 'No accepted proposal — make the invoice from Invoices.' });
    const i = Number(req.params.part);
    const split = proposal.terms.split && proposal.terms.split.length ? proposal.terms.split : [100];
    if (!Number.isInteger(i) || i < 0 || i >= split.length) return res.status(404).json({ error: 'No such payment' });
    const Invoice = require('../models/Invoice');
    const existing = await Invoice.findOne({ userId: req.userId, proposalId: proposal._id, part: i, status: { $ne: 'void' } }).lean();
    if (existing) return res.json({ invoiceId: String(existing._id) });
    const option = proposal.options[proposal.acceptedBy.option];
    const { partWord } = require('../lib/invoices/create');
    const inv = await createInvoice(req.userId, {
      dealId: d._id, proposalId: proposal._id, part: i, currency: proposal.currency,
      kind: i === 0 && split.length > 1 ? 'deposit' : i === split.length - 1 ? 'final' : 'milestone',
      items: [{ text: `${proposal.title} — ${option.name}: ${split[i]}% ${partWord(i, split.length)}`, qty: 1, rate: splitAmounts(option.price, split)[i] }],
    });
    await nextAfterPayment(req.userId, d._id);
    res.status(201).json({ invoiceId: String(inv._id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** A progress update drafted from the checklist (no AI: it only says what's ticked off). */
router.post('/:id/update/draft', async (req, res) => {
  try {
    const d = await load(req, res); if (!d) return;
    const p = await full(req.userId, d);
    const body = updateText({ deal: { ...d, project: p.project }, health: p.health, payments: p.payments });
    if (!body) return res.status(400).json({ error: 'Add the project’s steps to the checklist first — the update is written from them.' });
    const [prof, s] = await Promise.all([Profile.findOne({ userId: req.userId }).lean(), Settings.findOne({ userId: req.userId }, { senderName: 1 }).lean()]);
    const first = String(d.person || '').split(/\s+/)[0];
    res.json({ text: `Hi ${/^[A-Za-z][A-Za-z'-]+$/.test(first) ? first : 'there'},\n\n${body}\n\n${(s && s.senderName) || (prof && prof.name) || ''}`.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send a progress update in the client's thread. */
router.post('/:id/update/send', async (req, res) => {
  const text = String((req.body && req.body.text) || '').replace(/\r\n?/g, '\n').trim();
  if (text.length < 10) return res.status(400).json({ error: 'Write the update first.' });
  try {
    const d = await load(req, res); if (!d) return;
    if (!d.email && !d.conversationId) return res.status(400).json({ error: 'Add the client’s email to the deal first.' });
    const sent = await sendInThread(req.userId, { conversationId: d.conversationId, leadId: d.leadId, email: d.email, subject: `${d.name} — progress update`, text: text.slice(0, 6000) });
    const now = new Date();
    await Deal.updateOne({ _id: d._id, userId: req.userId }, {
      $push: { 'project.updates': { text: text.slice(0, 4000), at: now } },
      $set: { lastActivityAt: now, ...(sent.conversationId && !d.conversationId ? { conversationId: sent.conversationId } : {}) },
    });
    res.json(await full(req.userId, await Deal.findById(d._id).lean()));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
