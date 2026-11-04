const mongoose = require('mongoose');

/**
 * Everything one run read, and what happened to each — so "63 skipped" can be
 * opened and checked, and a post the rules got wrong can still be added
 * ("This is a lead", routes/sources.js).
 *
 * Short-lived on purpose: kept 14 days, text trimmed, so the free 512 MB tier
 * isn't spent on posts nobody chose. `item` keeps what's needed to build a lead
 * from a skipped post later; it is stored only for skipped ones.
 */
const OUTCOMES = ['lead', 'held', 'drop', 'repeat', 'updated', 'capped', 'added'];
const KEEP_DAYS = 14;

const runItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runId: { type: mongoose.Schema.Types.ObjectId, required: true },
  source: { type: String, required: true },
  // lead: became a lead · held: a lead without an email · drop: skipped by a rule ·
  // repeat: already had it · updated: added to a lead you had · capped: already with
  // other freelancers · added: skipped, then added by you
  outcome: { type: String, enum: OUTCOMES, required: true },
  reason: { type: String, default: '' },
  name: { type: String, default: '' },
  text: { type: String, default: '' },        // first 300 characters
  url: { type: String, default: null },
  email: { type: String, default: null },
  fit: { type: Number, default: null },
  leadId: { type: mongoose.Schema.Types.ObjectId, default: null },
  item: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

runItemSchema.index({ userId: 1, runId: 1, outcome: 1 });
runItemSchema.index({ createdAt: 1 }, { expireAfterSeconds: KEEP_DAYS * 24 * 3600 });

const RunItem = mongoose.model('RunItem', runItemSchema);
module.exports = RunItem;
Object.assign(module.exports, { OUTCOMES, KEEP_DAYS });
