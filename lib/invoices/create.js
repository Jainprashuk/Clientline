/**
 * Making invoices: by hand, the deposit when a proposal is accepted (registered
 * on lib/proposals/accept.js), and "invoice the rest" — the remaining parts of the
 * accepted option's payment split. Numbers are per user and gap-free.
 */
const Invoice = require('../../models/Invoice');
const Counter = require('../../models/Counter');
const Deal = require('../../models/Deal');
const Proposal = require('../../models/Proposal');
const Profile = require('../../models/Profile');
const { totals, splitAmounts } = require('./math');
const { afterAccept } = require('../proposals/accept');

const DAY = 86400000;
const PART_WORDS = ['to start', 'at the halfway demo', 'on delivery', 'final'];
const partWord = (i, n) => (n === 2 && i === 1 ? 'on delivery' : PART_WORDS[i] || 'final');

async function createInvoice(userId, { dealId = null, proposalId = null, kind = 'other', part = null, items = [], currency = 'INR', client = null, note = '' }) {
  const [profile, deal] = await Promise.all([
    Profile.findOne({ userId }).lean(),
    dealId ? Deal.findOne({ _id: dealId, userId }).lean() : null,
  ]);
  const billing = (profile && profile.billing) || {};
  // GST applies to Indian invoices only, and only if you charge it.
  const gstPercent = currency === 'INR' ? billing.gstPercent || 0 : 0;
  const seq = await Counter.next(userId, 'invoice');
  const number = `${billing.prefix || 'INV'}-${String(seq).padStart(4, '0')}`;
  const now = new Date();
  return (await Invoice.create({
    userId, dealId, proposalId, number, kind, part, currency, items, gstPercent, ...totals(items, gstPercent), note,
    client: client || { name: deal ? deal.client || deal.person : '', email: deal ? deal.email : '', address: '', taxId: '' },
    dueAt: new Date(now.getTime() + (billing.paymentDays == null ? 7 : billing.paymentDays) * DAY),
  })).toObject();
}

/** The invoice for one part of the accepted option's split. */
function partInvoice(userId, proposal, i) {
  const option = proposal.options[proposal.acceptedBy.option];
  const split = proposal.terms.split && proposal.terms.split.length ? proposal.terms.split : [100];
  const amounts = splitAmounts(option.price, split);
  const last = i === split.length - 1;
  return createInvoice(userId, {
    dealId: proposal.dealId, proposalId: proposal._id, part: i, currency: proposal.currency,
    kind: i === 0 && split.length > 1 ? 'deposit' : last ? 'final' : 'milestone',
    items: [{ text: `${proposal.title} — ${option.name}: ${split[i]}% ${partWord(i, split.length)}`, qty: 1, rate: amounts[i] }],
  });
}

// Accepting a proposal drafts the deposit invoice (you check it, then send it).
afterAccept(async (proposal) => { await partInvoice(proposal.userId, proposal, 0); });

/** The parts of the accepted proposal not invoiced yet. */
async function invoiceTheRest(userId, dealId) {
  const proposal = await Proposal.findOne({ userId, dealId, status: 'accepted' }).sort({ updatedAt: -1 }).lean();
  if (!proposal) return { error: 'There’s no accepted proposal on this deal — make the invoice by hand.' };
  const have = new Set((await Invoice.find({ userId, proposalId: proposal._id, status: { $ne: 'void' } }, { part: 1 }).lean()).map(x => x.part));
  const split = proposal.terms.split && proposal.terms.split.length ? proposal.terms.split : [100];
  const made = [];
  for (let i = 0; i < split.length; i++) if (!have.has(i)) made.push(await partInvoice(userId, proposal, i));
  return { made };
}

/** When everything invoiced on a deal is paid and covers its value, the deal is Paid. */
async function settleDeal(userId, dealId) {
  if (!dealId) return false;
  const deal = await Deal.findOne({ _id: dealId, userId }).lean();
  if (!deal || !['won', 'progress', 'delivered'].includes(deal.stage)) return false;
  const all = await Invoice.find({ userId, dealId, status: { $ne: 'void' } }, { status: 1, subtotal: 1 }).lean();
  const paid = all.filter(x => x.status === 'paid').reduce((a, x) => a + x.subtotal, 0);
  if (!all.length || all.some(x => x.status !== 'paid') || paid < deal.value) return false;
  const at = new Date();
  await Deal.updateOne({ _id: deal._id }, { $set: { stage: 'paid', next: '', lastActivityAt: at }, $push: { stageHistory: { stage: 'paid', at } } });
  return true;
}

module.exports = { createInvoice, invoiceTheRest, settleDeal, partWord };
