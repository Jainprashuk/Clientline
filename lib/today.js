/**
 * Today: everything that's waiting on you, in one list, most urgent first — and
 * the money at a glance. Built on read from what's already stored; nothing new.
 */
const Conversation = require('../models/Conversation');
const Proposal = require('../models/Proposal');
const Invoice = require('../models/Invoice');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');
const { WEAK } = require('./leads/score');
const { dueSummary } = require('./outreach/send');
const { healthOf } = require('./projects/project');
const { nudgeFor } = require('../routes/proposals');
const { reminderFor } = require('../routes/invoices');

const DAY = 86400000;
const fmt = (minor, c) => new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format((minor || 0) / 100);
const add = (t, c, v) => { t[c] = (t[c] || 0) + (v || 0); };

// Lower comes first.
const RANK = { changes: 1, accepted: 2, reply: 3, overdue: 4, late: 5, send: 6, remind: 7, nudge: 8, followups: 9, behind: 10, stale: 11, leads: 12, tasks: 13 };

async function today(userId) {
  const now = Date.now();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [convos, needsCount, proposals, invoices, deals, newLeads, due] = await Promise.all([
    Conversation.find({ userId, needsYou: true }, { leadId: 1, email: 1, category: 1, lastAt: 1, messages: { $slice: -1 } }).sort({ lastAt: -1 }).limit(5).lean(),
    Conversation.countDocuments({ userId, needsYou: true }),
    Proposal.find({ userId, status: { $in: ['sent', 'viewed', 'changes', 'accepted'] } }).lean(),
    Invoice.find({ userId, status: { $in: ['draft', 'sent', 'viewed', 'paid'] } }).lean(),
    Deal.find({ userId, stage: { $ne: 'lost' } }).lean(),
    Lead.countDocuments({ userId, status: 'new', fit: { $gte: WEAK } }),
    dueSummary(userId).catch(() => null),
  ]);
  const dealBy = new Map(deals.map(d => [String(d._id), d]));
  const leads = await Lead.find({ userId, _id: { $in: convos.map(c => c.leadId) } }, { name: 1, person: 1 }).lean();
  const leadBy = new Map(leads.map(l => [String(l._id), l]));
  const items = [];
  const push = (kind, title, detail, to, tone = 'normal') => items.push({ kind, title, detail, to, tone, rank: RANK[kind] || 50 });

  // Replies waiting on you.
  for (const c of convos) {
    const l = leadBy.get(String(c.leadId));
    const last = c.messages && c.messages[0];
    push('reply', `Reply to ${l ? l.person || l.name : c.email}`, (last && last.text ? last.text.replace(/\s+/g, ' ').slice(0, 120) : ''), `/inbox?c=${c._id}`, 'urgent');
  }
  if (needsCount > convos.length) push('reply', `${needsCount - convos.length} more replies waiting`, '', '/inbox');

  // Proposals.
  for (const p of proposals) {
    const d = dealBy.get(String(p.dealId));
    const who = d ? d.person || d.client : 'Client';
    if (p.status === 'changes') {
      const ask = p.changeRequests && p.changeRequests[p.changeRequests.length - 1];
      push('changes', `${who} asked for changes to “${p.title}”`, ask ? ask.text.slice(0, 140) : '', `/proposals?p=${p._id}`, 'urgent');
    } else if (p.status !== 'accepted') {
      const why = nudgeFor(p, now);
      if (why) push('nudge', `Nudge ${who} about “${p.title}”`, why, `/proposals?p=${p._id}`);
    }
  }

  // Invoices.
  for (const i of invoices) {
    const d = i.dealId && dealBy.get(String(i.dealId));
    const who = i.client.name || (d && d.client) || 'the client';
    if (i.status === 'draft' && i.total) {
      const fromAccept = i.kind === 'deposit' && i.createdAt && now - new Date(i.createdAt).getTime() < 7 * DAY;
      push(fromAccept ? 'accepted' : 'send', fromAccept ? `${who} accepted — send the deposit invoice` : `Send ${i.number} to ${who}`, `${i.number} · ${fmt(i.total, i.currency)}`, `/invoices?i=${i._id}`, fromAccept ? 'good' : 'normal');
    } else if (['sent', 'viewed'].includes(i.status)) {
      const overdue = i.dueAt && new Date(i.dueAt).getTime() < now;
      const r = reminderFor(i, now);
      if (overdue) push('overdue', `${i.number} is overdue — ${fmt(i.total, i.currency)} from ${who}`, r || 'A reminder was sent recently.', `/invoices?i=${i._id}`, 'urgent');
      else if (r) push('remind', `Remind ${who} about ${i.number}`, r, `/invoices?i=${i._id}`);
    }
  }

  // Projects slipping, and deals going quiet.
  for (const d of deals) {
    if (['won', 'progress'].includes(d.stage) && d.project && d.project.targetAt) {
      const h = healthOf(d, now);
      if (h.state === 'late') push('late', `${d.name} is ${h.label}`, `${h.done}/${h.total} done`, `/work?p=${d._id}`, 'urgent');
      else if (h.state === 'behind' || h.state === 'soon') push('behind', `${d.name}: ${h.label}`, `${h.done}/${h.total} done`, `/work?p=${d._id}`);
    }
    if (['talking', 'call'].includes(d.stage) && now - new Date(d.lastActivityAt).getTime() > 5 * DAY) {
      push('stale', `${d.name} has gone quiet`, d.next ? `Your next step: ${d.next}` : 'Nothing has happened for 5 days.', `/deals?d=${d._id}`);
    }
  }

  // Outreach and leads.
  if (due && due.first + due.followUps > 0) push('followups', `${due.first + due.followUps} email${due.first + due.followUps === 1 ? '' : 's'} due to send`, `${due.first} first · ${due.followUps} follow-up${due.followUps === 1 ? '' : 's'}`, '/outreach');
  if (due && due.tasks && due.tasks.length) push('tasks', `${due.tasks.length} sequence task${due.tasks.length === 1 ? '' : 's'} for you`, due.tasks.slice(0, 2).map(t => t.text).join(' · '), '/outreach');
  if (newLeads) push('leads', `${newLeads} new lead${newLeads === 1 ? '' : 's'} to review`, 'Approve the good ones, discard the rest.', '/leads');

  items.sort((a, b) => a.rank - b.rank);

  // Money.
  const pipeline = {}; const won = {}; const waiting = {}; const paidMonth = {};
  for (const d of deals) {
    if (['talking', 'call', 'proposal'].includes(d.stage)) add(pipeline, d.currency, d.value);
    if ((d.stageHistory || []).some(h => h.stage === 'won' && new Date(h.at) >= monthStart)) add(won, d.currency, d.value);
  }
  for (const i of invoices) {
    if (['sent', 'viewed'].includes(i.status)) add(waiting, i.currency, i.total);
    if (i.status === 'paid' && i.paidAt && new Date(i.paidAt) >= monthStart) add(paidMonth, i.currency, i.total);
  }
  return { items, money: { pipeline, won, waiting, paidMonth }, counts: { replies: needsCount, newLeads, projects: deals.filter(d => ['won', 'progress', 'delivered'].includes(d.stage)).length } };
}

module.exports = { today };
