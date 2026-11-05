/**
 * Right after a client accepts: a short thank-you from your Gmail, in your thread
 * with them, with the PDF of what was agreed attached. You're on the thread, so you
 * get the same copy. The one email Clientline sends without a press — it's a
 * receipt for what the client just did, not outreach.
 */
const Proposal = require('../../models/Proposal');
const Profile = require('../../models/Profile');
const Settings = require('../../models/Settings');
const { afterAccept } = require('./accept');
const { proposalPdf, amount } = require('./pdf');
const { splitAmounts } = require('../invoices/math');
const { sendInThread } = require('../inbox/sendInThread');

const fileName = (p) => `${String(p.title || 'proposal').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'proposal'}-agreed.pdf`;

async function fromFor(userId) {
  const [p, s] = await Promise.all([Profile.findOne({ userId }).lean(), Settings.findOne({ userId }, { senderName: 1 }).lean()]);
  return { name: (s && s.senderName) || (p && p.name) || '', site: String((p && p.portfolioUrl) || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') };
}

async function sendConfirmation(proposal, deal) {
  if (!deal || (!deal.email && !deal.conversationId)) return;
  const from = await fromFor(proposal.userId);
  const opt = proposal.options[proposal.acceptedBy.option];
  const split = proposal.terms.split && proposal.terms.split.length ? proposal.terms.split : [100];
  const deposit = splitAmounts(opt.price, split)[0];
  const first = String(proposal.acceptedBy.name || deal.person || '').split(/\s+/)[0];
  const text = `Hi ${/^[A-Za-z][A-Za-z'-]+$/.test(first) ? first : 'there'},

Thank you for going ahead! Attached is a copy of what we agreed: ${opt.name} for ${amount(opt.price, proposal.currency).replace(/^INR /, '₹')}, about ${opt.weeks} week${opt.weeks === 1 ? '' : 's'}.

${split.length > 1 ? `Next, I’ll send the first invoice (${split[0]}%, ${amount(deposit, proposal.currency).replace(/^INR /, '₹')}) so we can get started.` : 'I’ll send the invoice shortly.'}

${from.name}`;
  const pdf = await proposalPdf(proposal, { from, client: deal.client || deal.person });
  await sendInThread(proposal.userId, {
    conversationId: deal.conversationId, leadId: deal.leadId, email: deal.email,
    subject: `Proposal: ${proposal.title}`, text,
    attachments: [{ filename: fileName(proposal), content: pdf, contentType: 'application/pdf' }],
  });
  await Proposal.updateOne({ _id: proposal._id }, { $set: { confirmedAt: new Date() } });
}

afterAccept(sendConfirmation);

module.exports = { sendConfirmation, fileName, fromFor };
