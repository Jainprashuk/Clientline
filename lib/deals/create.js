/**
 * Starting a deal from a lead, an Inbox conversation, or by hand. One open deal per
 * lead: starting another returns the open one. Starting one stops the lead's
 * sequence (they're in a real conversation now) and reads red flags from what
 * they wrote.
 */
const Deal = require('../../models/Deal');
const Lead = require('../../models/Lead');
const Profile = require('../../models/Profile');
const Conversation = require('../../models/Conversation');
const Enrollment = require('../../models/Enrollment');
const { flagsFor } = require('./flags');

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const ordinary = (s) => String(s || '').replace(/\s*\([^)]*\)/g, '').trim();

/** Everything the client wrote: their post and their replies. */
function theirWords(lead, convo) {
  return [lead && lead.about, ...((lead && lead.signals) || []).map(s => s.text),
    ...((convo && convo.messages) || []).filter(m => m.direction === 'in').map(m => m.text)].filter(Boolean).join('\n');
}

/** Red flags for a deal, against your minimum (only when the currencies match). */
function flagsForDeal(deal, lead, convo, profile) {
  const sameCurrency = (profile && profile.currency) === deal.currency;
  const minimum = sameCurrency ? Math.round(((profile && profile.minProject) || 0) * 100) : 0;
  return flagsFor(theirWords(lead, convo), { value: deal.value, minimum });
}

async function createDeal(userId, body = {}) {
  let convo = body.conversationId ? await Conversation.findOne({ _id: body.conversationId, userId }).lean() : null;
  const leadId = body.leadId || (convo && convo.leadId) || null;
  const lead = leadId ? await Lead.findOne({ _id: leadId, userId }).lean() : null;
  if ((body.leadId || body.conversationId) && !lead) return { error: 'No such lead' };
  if (lead) {
    const open = await Deal.findOne({ userId, leadId: lead._id, stage: { $in: Deal.OPEN } }).lean();
    if (open) return { deal: open, existing: true };
    if (!convo) convo = await Conversation.findOne({ userId, leadId: lead._id }).lean();
  }
  const profile = (await Profile.findOne({ userId }).lean()) || {};
  const budget = lead && lead.budget && lead.budget.amount && !lead.budget.hourly ? lead.budget : null;
  const now = new Date();
  const deal = {
    userId,
    leadId: lead ? lead._id : null,
    conversationId: convo ? convo._id : null,
    name: clip(body.name, 120) || (lead && lead.service ? `${ordinary(lead.service)} for ${lead.name}` : lead ? `Work for ${lead.name}` : 'New deal'),
    client: clip(body.client, 120) || (lead ? lead.name : ''),
    person: clip(body.person, 120) || (lead ? lead.person || '' : ''),
    email: clip(body.email, 200).toLowerCase() || (convo && convo.email) || (lead && lead.email) || '',
    value: Number.isFinite(Number(body.value)) && Number(body.value) > 0 ? Math.round(Number(body.value) * 100) : budget ? Math.round(budget.amount * 100) : 0,
    currency: Deal.CURRENCIES.includes(body.currency) ? body.currency : (budget && Deal.CURRENCIES.includes(budget.currency) ? budget.currency : profile.currency || 'INR'),
    stage: 'talking',
    stageHistory: [{ stage: 'talking', at: now }],
    lastActivityAt: now,
  };
  deal.flags = flagsForDeal(deal, lead, convo, profile);
  const created = await Deal.create(deal);
  // They're in a real conversation now: no more sequence emails.
  if (lead) {
    await Enrollment.updateMany({ userId, leadId: lead._id, status: { $in: ['active', 'paused'] } }, { $set: { status: 'stopped', stopReason: 'deal', sendingUntil: null } });
  }
  return { deal: created.toObject(), existing: false };
}

module.exports = { createDeal, flagsForDeal, theirWords };
