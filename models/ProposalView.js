const mongoose = require('mongoose');

/** One open of a proposal page by the client. Kept 180 days. */
const schema = new mongoose.Schema({
  proposalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  at: { type: Date, default: Date.now },
  ipHash: { type: String, default: '' },
  ua: { type: String, default: '', maxlength: 300 },
}, { versionKey: false });
schema.index({ proposalId: 1, at: -1 });
schema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

module.exports = mongoose.model('ProposalView', schema);
