/**
 * A won deal as a project: the accepted option's items as a checklist, dates
 * (started when the deposit came in, target = start + the weeks quoted), the
 * payment split as a timeline matched to its invoices, links and notes.
 * Seeded once, the first time the project is opened; after that it's yours.
 */
const Deal = require('../../models/Deal');
const Proposal = require('../../models/Proposal');
const Invoice = require('../../models/Invoice');
const { splitAmounts } = require('../invoices/math');
const { partWord } = require('../invoices/create');

const DAY = 86400000;
const PROJECT_STAGES = ['won', 'progress', 'delivered'];

async function contextFor(userId, deal) {
  const [proposal, invoices] = await Promise.all([
    Proposal.findOne({ userId, dealId: deal._id, status: 'accepted' }).sort({ updatedAt: -1 }).lean(),
    Invoice.find({ userId, dealId: deal._id, status: { $ne: 'void' } }).sort({ createdAt: 1 }).lean(),
  ]);
  return { proposal, invoices };
}

/**
 * Everything the option includes, with "All Essentials features" replaced by the
 * smaller option's own items (and so on down), without repeats.
 */
function itemsOf(proposal, index) {
  const out = [];
  const add = (i) => {
    for (const it of proposal.options[i].items) {
      const m = it.match(/^(?:all|everything in)\s+(?:the\s+)?(.+?)(?:\s+(?:features|option|plan))?(?:,?\s*plus)?$/i);
      const lower = m && proposal.options.findIndex((o, n) => n < i && o.name.toLowerCase() === m[1].toLowerCase());
      if (lower != null && lower >= 0) add(lower);
      else if (!out.some(x => x.toLowerCase() === it.toLowerCase())) out.push(it);
    }
  };
  add(index);
  return out;
}

// Proposal lines that describe terms, not a piece of work to tick off.
const NOT_A_STEP = /\b(?:rounds?\s+of\s+(?:changes|revisions|edits)|revisions?\b|post[\s-]launch\s+support|support\s+for|warranty|maintenance|handover\s+call|priority\s+support|bug\s+fixes\s+for)/i;

/**
 * The checklist Clientline suggests from the accepted option, for you to review:
 * [{ text, keep, why }]. Null once you've approved or skipped it.
 */
function suggestedChecklist(deal, proposal) {
  const p = deal.project || {};
  if (p.checklistReviewed || (p.tasks && p.tasks.length) || !proposal || !proposal.acceptedBy) return null;
  return itemsOf(proposal, proposal.acceptedBy.option).map(text => (NOT_A_STEP.test(text)
    ? { text, keep: false, why: 'Reads like a term of the deal, not a step of work' }
    : { text, keep: true, why: '' }));
}

/** First open: start and target dates. */
async function ensureSeeded(userId, deal, { proposal, invoices }) {
  if (deal.project && deal.project.started) return deal;
  const option = proposal && proposal.acceptedBy ? proposal.options[proposal.acceptedBy.option] : null;
  const firstPaid = invoices.filter(i => i.status === 'paid' && i.paidAt).sort((a, b) => a.paidAt - b.paidAt)[0];
  const wonAt = [...(deal.stageHistory || [])].reverse().find(h => h.stage === 'won');
  const startedAt = (firstPaid && firstPaid.paidAt) || (wonAt && wonAt.at) || new Date();
  const set = {
    'project.started': true,
    ...(deal.project && deal.project.links ? {} : { 'project.links': [] }),
    ...(deal.project && deal.project.notes ? {} : { 'project.notes': [] }),
    ...(deal.project && deal.project.updates ? {} : { 'project.updates': [] }),
    'project.startedAt': startedAt,
    'project.targetAt': option ? new Date(new Date(startedAt).getTime() + option.weeks * 7 * DAY) : null,
  };
  // The checklist is only suggested here (suggestedChecklist); you approve it first.
  return Deal.findOneAndUpdate({ _id: deal._id, userId }, { $set: set }, { returnDocument: 'after' }).lean();
}

/** The payment split, part by part, with the invoice for each (if any). */
function paymentsFor(proposal, invoices) {
  if (!proposal || !proposal.acceptedBy) {
    return invoices.map(i => ({ label: i.items[0] ? i.items[0].text : i.number, amount: i.total, currency: i.currency, invoice: brief(i) }));
  }
  const option = proposal.options[proposal.acceptedBy.option];
  const split = proposal.terms.split && proposal.terms.split.length ? proposal.terms.split : [100];
  const amounts = splitAmounts(option.price, split);
  const parts = split.map((pct, i) => {
    const inv = invoices.find(x => x.proposalId && String(x.proposalId) === String(proposal._id) && x.part === i);
    return { part: i, label: `${pct}% ${partWord(i, split.length)}`, amount: amounts[i], currency: proposal.currency, invoice: inv ? brief(inv) : null };
  });
  // Anything invoiced by hand on top.
  for (const i of invoices.filter(x => x.part == null || !x.proposalId)) parts.push({ label: i.items[0] ? i.items[0].text : i.number, amount: i.subtotal, currency: i.currency, invoice: brief(i) });
  return parts;
}
const brief = (i) => ({ id: String(i._id), number: i.number, status: i.status, total: i.total, dueAt: i.dueAt, paidAt: i.paidAt, overdue: !!(i.dueAt && ['sent', 'viewed'].includes(i.status) && new Date(i.dueAt) < new Date()) });

/** On track, due soon, late — from the target date and how much is ticked off. */
function healthOf(deal, now = Date.now()) {
  const p = deal.project || {};
  const tasks = p.tasks || [];
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  if (deal.stage === 'delivered' || deal.stage === 'paid') return { pct: tasks.length ? pct : 100, done, total: tasks.length, state: 'delivered', label: 'Delivered' };
  if (!p.targetAt) return { pct, done, total: tasks.length, state: 'none', label: 'No target date' };
  const days = Math.ceil((new Date(p.targetAt).getTime() - now) / DAY);
  if (days < 0) return { pct, done, total: tasks.length, state: 'late', label: `${-days} day${days === -1 ? '' : 's'} late`, days };
  const span = p.startedAt ? new Date(p.targetAt).getTime() - new Date(p.startedAt).getTime() : 0;
  const expected = span > 0 ? Math.min(100, Math.round(((now - new Date(p.startedAt).getTime()) / span) * 100)) : 0;
  if (tasks.length && pct + 25 < expected) return { pct, done, total: tasks.length, state: 'behind', label: `Behind — ${days} day${days === 1 ? '' : 's'} left`, days };
  if (days <= 3) return { pct, done, total: tasks.length, state: 'soon', label: days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`, days };
  return { pct, done, total: tasks.length, state: 'ok', label: `On track — ${days} days left`, days };
}

/** The next payment step, for the card. */
function nextPayment(payments) {
  const sent = payments.find(p => p.invoice && ['sent', 'viewed'].includes(p.invoice.status));
  if (sent) return { text: `${sent.invoice.number} ${sent.invoice.overdue ? 'overdue' : 'waiting'}`, tone: sent.invoice.overdue ? 'late' : 'wait' };
  const draft = payments.find(p => p.invoice && p.invoice.status === 'draft');
  if (draft) return { text: `${draft.invoice.number} to send`, tone: 'todo' };
  const notYet = payments.find(p => !p.invoice);
  if (notYet) return { text: `Next: ${notYet.label}`, tone: 'later' };
  return payments.length ? { text: 'All paid', tone: 'ok' } : null;
}

module.exports = { itemsOf, suggestedChecklist, contextFor, ensureSeeded, paymentsFor, healthOf, nextPayment, PROJECT_STAGES };
