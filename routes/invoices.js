/**
 * Invoices: list (with what's waiting), one, make one by hand, edit until it's
 * paid, preview, send the link in the deal's thread, send a reminder (suggested,
 * never automatic), mark paid, cancel, and "invoice the rest" of a deal.
 * Every query is scoped to req.userId.
 */
const express = require('express');
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Deal = require('../models/Deal');
const Profile = require('../models/Profile');
const Settings = require('../models/Settings');
const { totals } = require('../lib/invoices/math');
const { createInvoice, invoiceTheRest, settleDeal } = require('../lib/invoices/create');
const { renderInvoice, fmt } = require('../lib/invoices/page');
const { issueToken, linkFor } = require('../lib/docs/token');
const { sendInThread } = require('../lib/inbox/sendInThread');
const { appUrl } = require('../lib/emailLayout');

const router = express.Router();
const validId = (id) => mongoose.isValidObjectId(id);
const DAY = 86400000;
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/** When a reminder would help, and why — never sent on its own. */
function reminderFor(inv, now = Date.now()) {
  if (!['sent', 'viewed'].includes(inv.status) || !inv.dueAt) return null;
  const due = new Date(inv.dueAt).getTime();
  const last = inv.remindersSent && inv.remindersSent.length ? new Date(inv.remindersSent[inv.remindersSent.length - 1]).getTime() : 0;
  const days = Math.round((due - now) / DAY);
  if (days > 0 && days <= 2 && now - last > 2 * DAY) return `Due in ${days} day${days === 1 ? '' : 's'} — a friendly heads-up helps it get paid on time.`;
  if (days <= 0 && days > -1 && now - last > DAY) return 'Due today.';
  if (days <= -1 && now - last > 7 * DAY) return `Overdue by ${-days} day${days === -1 ? '' : 's'} — time for a polite reminder.`;
  return null;
}

const view = (inv, deal) => ({
  ...inv, id: String(inv._id), _id: undefined, userId: undefined, tokenHash: undefined, tokenEnc: undefined, __v: undefined,
  link: linkFor('i', inv), reminder: reminderFor(inv), overdue: !!(inv.dueAt && ['sent', 'viewed'].includes(inv.status) && new Date(inv.dueAt) < new Date()),
  deal: deal ? { id: String(deal._id), name: deal.name, client: deal.client, stage: deal.stage } : undefined,
});

async function sender(userId) {
  const [p, s] = await Promise.all([Profile.findOne({ userId }).lean(), Settings.findOne({ userId }, { senderName: 1, gmailEmail: 1 }).lean()]);
  return { name: (s && s.senderName) || (p && p.name) || '', email: (s && s.gmailEmail) || '', billing: (p && p.billing) || {} };
}

/** Lines from the editor: text, qty, rate in major units. */
function cleanItems(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 30).map(it => ({
    text: clean(it && it.text, 300),
    qty: Math.max(0, Math.round((Number(it && it.qty) || 1) * 100) / 100),
    rate: Math.round(Math.max(0, Number(it && it.rate) || 0) * 100),
  })).filter(it => it.text && it.rate > 0);
}

router.get('/', async (req, res) => {
  try {
    const q = { userId: req.userId };
    if (req.query.dealId && validId(req.query.dealId)) q.dealId = req.query.dealId;
    const list = await Invoice.find(q).sort({ createdAt: -1 }).limit(500).lean();
    const deals = await Deal.find({ userId: req.userId, _id: { $in: list.map(i => i.dealId).filter(Boolean) } }, { name: 1, client: 1, stage: 1 }).lean();
    const by = new Map(deals.map(d => [String(d._id), d]));
    // What's waiting and what came in this month, per currency.
    const waiting = {}; const paidMonth = {};
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    for (const i of list) {
      if (['sent', 'viewed'].includes(i.status)) waiting[i.currency] = (waiting[i.currency] || 0) + i.total;
      if (i.status === 'paid' && i.paidAt && i.paidAt >= monthStart) paidMonth[i.currency] = (paidMonth[i.currency] || 0) + i.total;
    }
    res.json({ invoices: list.map(i => view(i, i.dealId && by.get(String(i.dealId)))), waiting, paidMonth });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such invoice' });
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!inv) return res.status(404).json({ error: 'No such invoice' });
    const deal = inv.dealId ? await Deal.findOne({ _id: inv.dealId, userId: req.userId }).lean() : null;
    res.json(view(inv, deal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** By hand: { dealId?, client, currency, items:[{text, qty, rate}], note }. */
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (b.dealId && !validId(b.dealId)) return res.status(404).json({ error: 'No such deal' });
  const items = cleanItems(b.items);
  try {
    const deal = b.dealId ? await Deal.findOne({ _id: b.dealId, userId: req.userId }).lean() : null;
    const currency = ['INR', 'USD', 'EUR', 'GBP'].includes(b.currency) ? b.currency : deal ? deal.currency : 'INR';
    const inv = await createInvoice(req.userId, {
      dealId: deal ? deal._id : null, currency, note: String(b.note || '').slice(0, 600),
      items: items.length ? items : [{ text: deal ? deal.name : 'Work', qty: 1, rate: deal && deal.value ? deal.value : 0 }],
      client: b.client ? { name: clean(b.client.name, 160), email: clean(b.client.email, 200).toLowerCase(), address: String(b.client.address || '').trim().slice(0, 500), taxId: clean(b.client.taxId, 40).toUpperCase() } : null,
    });
    res.status(201).json(view(inv, deal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** The remaining parts of a deal's accepted proposal. */
router.post('/deal/:dealId/rest', async (req, res) => {
  if (!validId(req.params.dealId)) return res.status(404).json({ error: 'No such deal' });
  try {
    const r = await invoiceTheRest(req.userId, req.params.dealId);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ made: r.made.map(i => view(i)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such invoice' });
  const b = req.body || {};
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!inv) return res.status(404).json({ error: 'No such invoice' });
    if (['paid', 'void'].includes(inv.status)) return res.status(409).json({ error: inv.status === 'paid' ? 'It’s paid — it can’t change now.' : 'It’s cancelled.' });
    const $set = {};
    if (b.items) {
      const items = cleanItems(b.items);
      if (!items.length) return res.status(400).json({ error: 'Add at least one line with an amount.' });
      $set.items = items;
    }
    if (b.gstPercent != null) $set.gstPercent = inv.currency === 'INR' && [0, 5, 12, 18, 28].includes(Number(b.gstPercent)) ? Number(b.gstPercent) : 0;
    if (b.client && typeof b.client === 'object') {
      for (const [k, n] of [['name', 160], ['email', 200], ['taxId', 40]]) if (typeof b.client[k] === 'string') $set[`client.${k}`] = clean(b.client[k], n);
      if (typeof b.client.address === 'string') $set['client.address'] = b.client.address.trim().slice(0, 500);
    }
    if (typeof b.note === 'string') $set.note = b.note.trim().slice(0, 600);
    if (b.dueAt) {
      const d = new Date(b.dueAt);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Pick a due date.' });
      $set.dueAt = d;
    }
    const items = $set.items || inv.items;
    Object.assign($set, totals(items, $set.gstPercent != null ? $set.gstPercent : inv.gstPercent));
    const u = await Invoice.findOneAndUpdate({ _id: inv._id, userId: req.userId }, { $set }, { returnDocument: 'after' }).lean();
    res.json(view(u));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/preview', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).send('Not found');
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!inv) return res.status(404).send('Not found');
    res.set('Cache-Control', 'no-store').send(await renderInvoice(inv, { from: await sender(req.userId), preview: true }));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

function defaultMessage(inv, kind, from) {
  const first = String(inv.client.name || '').split(/\s+/)[0];
  const hi = `Hi ${/^[A-Za-z][A-Za-z'-]+$/.test(first) ? first : 'there'},`;
  const amt = fmt(inv.total, inv.currency);
  const due = inv.dueAt ? new Date(inv.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : '';
  const how = inv.currency === 'INR' && from.billing.upiId ? 'You can pay by scanning the UPI QR on that page.' : 'Payment details are on that page.';
  if (kind === 'remind') {
    const late = inv.dueAt && new Date(inv.dueAt) < new Date();
    return `${hi}\n\n${late ? `A gentle reminder that invoice ${inv.number} (${amt}) was due on ${due}.` : `A quick heads-up that invoice ${inv.number} (${amt}) is due on ${due}.`} Here it is again:\n{{link}}\n\n${how} If it’s already on its way, thank you — please ignore this.\n\n${from.name}`.trim();
  }
  return `${hi}\n\nHere’s invoice ${inv.number} for ${amt}${due ? `, due ${due}` : ''}:\n{{link}}\n\n${how} Thank you!\n\n${from.name}`.trim();
}

router.get('/:id/message', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such invoice' });
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!inv) return res.status(404).json({ error: 'No such invoice' });
    res.json({ text: defaultMessage(inv, req.query.kind === 'remind' ? 'remind' : 'send', await sender(req.userId)), to: inv.client.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send (or remind): the link goes in the deal's thread, or a new email to the client. */
async function deliver(req, res, kind) {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such invoice' });
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!inv) return res.status(404).json({ error: 'No such invoice' });
    if (['paid', 'void'].includes(inv.status)) return res.status(409).json({ error: inv.status === 'paid' ? 'It’s already paid.' : 'It’s cancelled.' });
    if (!inv.total) return res.status(400).json({ error: 'The invoice has no amount.' });
    if (kind === 'remind' && inv.status === 'draft') return res.status(400).json({ error: 'Send it first.' });
    if (!appUrl()) return res.status(400).json({ error: 'The app’s public address (CLIENTLINE_URL) is not set, so the link can’t be made.' });
    const from = await sender(req.userId);
    if (inv.currency === 'INR' && !from.billing.upiId && !from.billing.payDetails) return res.status(400).json({ error: 'Add your UPI ID or bank details in My profile → Getting paid first, so the client knows how to pay.' });
    const deal = inv.dealId ? await Deal.findOne({ _id: inv.dealId, userId: req.userId }).lean() : null;
    if (!inv.client.email && !(deal && (deal.conversationId || deal.email))) return res.status(400).json({ error: 'Add the client’s email to the invoice first.' });

    const tok = inv.tokenEnc ? null : issueToken();
    const now = new Date();
    const firstSend = inv.status === 'draft';
    const paymentDays = from.billing.paymentDays == null ? 7 : from.billing.paymentDays;
    const set = { ...(tok ? { tokenHash: tok.tokenHash, tokenEnc: tok.tokenEnc } : {}), ...(firstSend ? { status: 'sent', issuedAt: now, dueAt: new Date(now.getTime() + paymentDays * DAY) } : {}) };
    // Save the token (and the issue date the page shows) before the email goes.
    const ready = Object.keys(set).length ? await Invoice.findOneAndUpdate({ _id: inv._id }, { $set: set }, { returnDocument: 'after' }).lean() : inv;
    const link = linkFor('i', ready);
    let text = String((req.body && req.body.message) || defaultMessage(ready, kind, from)).replace(/\r\n?/g, '\n').trim();
    if (!text.includes('{{link}}') && !text.includes(link)) text = `${text}\n\n${link}`;
    text = text.replace('{{link}}', link).slice(0, 6000);
    try {
      await sendInThread(req.userId, {
        conversationId: deal && deal.conversationId, leadId: deal && deal.leadId,
        email: inv.client.email || (deal && deal.email), subject: `Invoice ${inv.number}`, text,
      });
    } catch (err) {
      // Not sent: it stays a draft, so nothing claims it went.
      if (firstSend) await Invoice.updateOne({ _id: inv._id }, { $set: { status: 'draft', issuedAt: null } });
      throw err;
    }
    const u = kind === 'remind'
      ? await Invoice.findOneAndUpdate({ _id: inv._id }, { $push: { remindersSent: now } }, { returnDocument: 'after' }).lean()
      : await Invoice.findById(inv._id).lean();
    if (deal) await Deal.updateOne({ _id: deal._id }, { $set: { lastActivityAt: now, ...(firstSend ? { next: `Wait for ${inv.number} to be paid` } : {}) } });
    res.json(view(u, deal));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}
router.post('/:id/send', (req, res) => deliver(req, res, 'send'));
router.post('/:id/remind', (req, res) => deliver(req, res, 'remind'));

/** { paid: true | false } — you mark it when the money arrives. */
router.post('/:id/paid', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such invoice' });
  const paid = !(req.body && req.body.paid === false);
  try {
    const inv = await Invoice.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!inv) return res.status(404).json({ error: 'No such invoice' });
    if (inv.status === 'void') return res.status(409).json({ error: 'It’s cancelled.' });
    const u = await Invoice.findOneAndUpdate({ _id: inv._id }, { $set: paid ? { status: 'paid', paidAt: new Date() } : { status: inv.issuedAt ? 'sent' : 'draft', paidAt: null } }, { returnDocument: 'after' }).lean();
    const settled = paid ? await settleDeal(req.userId, inv.dealId) : false;
    res.json({ ...view(u), dealPaid: settled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Cancel (numbers are never reused, so a cancelled invoice stays listed). */
router.post('/:id/void', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such invoice' });
  try {
    const u = await Invoice.findOneAndUpdate({ _id: req.params.id, userId: req.userId, status: { $ne: 'paid' } }, { $set: { status: 'void' } }, { returnDocument: 'after' }).lean();
    if (!u) return res.status(409).json({ error: 'A paid invoice can’t be cancelled — mark it unpaid first.' });
    res.json(view(u));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.reminderFor = reminderFor;
