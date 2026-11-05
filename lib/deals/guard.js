/**
 * Send-time guard, as in Outreach (lib/interviewGuard.js): once someone is in an
 * open deal you're in a real conversation, so no sequence email goes to them —
 * checked at send time by address, whatever their enrolment says.
 */
const Deal = require('../../models/Deal');

/** Addresses in this user's open deals. */
async function dealEmails(userId) {
  const rows = await Deal.find({ userId, stage: { $in: Deal.OPEN }, email: { $ne: '' } }, { email: 1 }).lean();
  return new Set(rows.map(r => r.email));
}

module.exports = { dealEmails, IN_DEAL: 'They’re in a deal — sequences don’t write to them' };
