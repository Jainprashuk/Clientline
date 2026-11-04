const mongoose = require('mongoose');

/**
 * One "send what's due" in the background — started by the user ("Send due
 * emails") or by the hourly job — and what it has done so far. The floating
 * sending panel reads this; Stop sets `stopRequested`, which the sender checks
 * between batches.
 */
const STALE_MS = 30 * 60 * 1000;

const sendRunSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  trigger: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  status: { type: String, enum: ['queued', 'running', 'done', 'stopped', 'failed'], default: 'queued' },
  // "Send selected": only these enrolments; null = everything due.
  only: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  total: { type: Number, default: 0 },          // due when the run started
  sent: { type: Number, default: 0 },
  skipped: { type: [{ name: String, reason: String, _id: false }], default: [] },
  last: { name: String, email: String },         // the most recent email sent
  stoppedBy: { type: String, default: null },    // why it ended early (Gmail limit, no Gmail…)
  stopRequested: { type: Boolean, default: false },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null },
}, { versionKey: false });

sendRunSchema.index({ userId: 1, startedAt: -1 });
sendRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

const SendRun = mongoose.model('SendRun', sendRunSchema);
module.exports = SendRun;
module.exports.STALE_MS = STALE_MS;
