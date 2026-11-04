const mongoose = require('mongoose');

/**
 * Who has been given a shared lead.
 *
 * A post on HN or a public web post is visible to every Clientline user whose
 * profile matches it. Without a cap, ten freelancers would email the same
 * client within an hour, and the client would answer none of them. So each
 * shared lead goes to at most CAP accounts, first come first served.
 *
 * Keyed by the post URL (or email) rather than per account, which is the point.
 */
const CAP = 3;

const leadShareSchema = new mongoose.Schema({
  key: { type: String, required: true },
  userIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
}, { timestamps: true });

leadShareSchema.index({ key: 1 }, { unique: true });

/**
 * Claim a place for this user. True if they already had one or got one now;
 * false when the lead is already with CAP others. Atomic: the size check is in
 * the update's filter, so two users racing for the last place can't both win.
 */
leadShareSchema.statics.claim = async function claim(key, userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  // Create the row if this is the first claim; a duplicate-key race just means it exists.
  await this.updateOne({ key }, { $setOnInsert: { key, userIds: [] } }, { upsert: true }).catch((err) => {
    if (err.code !== 11000) throw err;
  });
  const already = await this.exists({ key, userIds: uid });
  if (already) return true;
  const r = await this.updateOne(
    { key, userIds: { $ne: uid }, [`userIds.${CAP - 1}`]: { $exists: false } },
    { $addToSet: { userIds: uid } },
  );
  return r.modifiedCount === 1;
};

const LeadShare = mongoose.model('LeadShare', leadShareSchema);
module.exports = LeadShare;
module.exports.CAP = CAP;
