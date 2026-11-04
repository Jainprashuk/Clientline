const mongoose = require('mongoose');

/**
 * Addresses and domains never to email again, per account: unsubscribes, bounces
 * and anything the user blocks by hand. Checked before every enrolment and every
 * send. From Outreach's models/Blocklist.js.
 */
const blocklistSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ['email', 'domain'], required: true },
  value: { type: String, required: true, lowercase: true, trim: true }, // address, or a bare domain ("acme.com")
  // unsubscribed · bounced · asked-to-stop · manual
  reason: { type: String, default: 'manual' },
}, { timestamps: true });

blocklistSchema.index({ userId: 1, type: 1, value: 1 }, { unique: true });

const Blocklist = mongoose.model('Blocklist', blocklistSchema);

/** Blocks an address for this account. Idempotent. */
Blocklist.blockEmail = (userId, email, reason) => Blocklist.updateOne(
  { userId, type: 'email', value: String(email || '').toLowerCase().trim() },
  { $setOnInsert: { reason } },
  { upsert: true },
).catch(err => { if (err.code !== 11000) throw err; });

module.exports = Blocklist;
