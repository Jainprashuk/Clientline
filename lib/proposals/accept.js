/**
 * The client accepting on the proposal page. Atomic, so a double click or a second
 * tab can't accept twice; refused if the proposal changed since the page loaded
 * (the hash they saw must match) or has expired. Moves the deal to Won and calls
 * `afterAccept` (the deposit invoice).
 */
const Proposal = require('../../models/Proposal');
const Deal = require('../../models/Deal');
const { contentHash, isExpired } = require('./page');

const hooks = [];
/** Something to do once a proposal is accepted (invoices register here). */
const afterAccept = (fn) => hooks.push(fn);

async function acceptProposal(p, { name, option, hash, ipHash }) {
  const who = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const i = Number(option);
  if (p.status === 'accepted') return { error: 'This proposal has already been accepted.' };
  if (!['sent', 'viewed'].includes(p.status)) return { error: 'This proposal isn’t open for acceptance.' };
  if (isExpired(p)) return { error: 'This proposal has expired.' };
  if (who.length < 2) return { error: 'Type your full name to accept.' };
  if (!Number.isInteger(i) || !p.options[i]) return { error: 'Pick one of the options.' };
  const current = contentHash(p);
  if (hash !== current) return { error: 'This proposal was just updated. Check it again, then accept.', changed: true };
  const at = new Date();
  const done = await Proposal.findOneAndUpdate(
    { _id: p._id, status: { $in: ['sent', 'viewed'] } },
    { $set: { status: 'accepted', acceptedBy: { name: who, option: i, at, ipHash, contentHash: current } } },
    { returnDocument: 'after' },
  ).lean();
  if (!done) return { error: 'This proposal has already been accepted.' };
  const deal = await Deal.findOne({ _id: p.dealId, userId: p.userId }).lean();
  if (deal && ['talking', 'call', 'proposal'].includes(deal.stage)) {
    await Deal.updateOne({ _id: deal._id }, {
      $set: { stage: 'won', value: done.options[i].price, currency: done.currency, next: 'Send the deposit invoice', lastActivityAt: at },
      $push: { stageHistory: { stage: 'won', at } },
    });
  }
  for (const fn of hooks) {
    try { await fn(done, deal); } catch (err) { console.error(`[proposals] after-accept failed: ${err.message}`); }
  }
  return { proposal: done };
}

module.exports = { acceptProposal, afterAccept };
