/**
 * The client asking for changes on the proposal page: kept on the proposal, put in
 * your Inbox thread with them (so it sits with the rest of the conversation, as
 * "needs you"), the deal's next step updated, and an email to you.
 */
const Proposal = require('../../models/Proposal');
const Deal = require('../../models/Deal');
const Conversation = require('../../models/Conversation');
const { onChanges } = require('./alerts');

async function askForChanges(p, { name, text }) {
  const who = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const what = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, 3000);
  if (p.status === 'accepted') return { error: 'This proposal has already been accepted.' };
  if (who.length < 2) return { error: 'Type your name.' };
  if (what.length < 5) return { error: 'Say what you’d change.' };
  const at = new Date();
  await Proposal.updateOne({ _id: p._id }, { $set: { status: 'changes' }, $push: { changeRequests: { name: who, text: what, at } } });

  const deal = await Deal.findOne({ _id: p.dealId, userId: p.userId }).lean();
  if (deal) {
    await Deal.updateOne({ _id: deal._id }, { $set: { next: 'They asked for changes — update the proposal and send it again', lastActivityAt: at } });
    const convo = deal.conversationId
      ? await Conversation.findOne({ _id: deal.conversationId, userId: p.userId }).lean()
      : deal.leadId ? await Conversation.findOne({ userId: p.userId, leadId: deal.leadId }).lean() : null;
    const message = { direction: 'in', from: deal.email || who, subject: `Changes asked on “${p.title}”`, text: `${who} asked for changes on the proposal “${p.title}” (from the proposal page):\n\n${what}`, messageId: null, at };
    const set = { needsYou: true, unread: true, lastInboundAt: at, lastAt: at, doneAt: null, snoozedUntil: null, category: 'wants-quote', categoryWhy: 'Asked for changes on your proposal', categoryBy: 'rule' };
    if (convo) await Conversation.updateOne({ _id: convo._id }, { $push: { messages: { $each: [message], $slice: -50 } }, $set: set });
    else if (deal.leadId && deal.email) {
      const c = await Conversation.create({ userId: p.userId, leadId: deal.leadId, email: deal.email, subject: `Proposal: ${p.title}`, messages: [message], ...set });
      await Deal.updateOne({ _id: deal._id }, { $set: { conversationId: c._id } });
    }
  }
  await onChanges(p, { name: who, text: what });
  return { ok: true };
}

module.exports = { askForChanges };
