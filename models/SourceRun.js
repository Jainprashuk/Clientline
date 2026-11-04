const mongoose = require('mongoose');

/**
 * One run of one source for one account: what was read, what became a lead,
 * and why the rest didn't. From Outreach's models/SourceRun.js, with the
 * reasons kept so the Leads page can say "38 dropped: 21 not your service,
 * 9 outside where you work…" instead of a bare zero.
 */
const SOURCES = ['paste', 'hn', 'news', 'web-post'];
const STALE_MS = 30 * 60 * 1000;

const sourceRunSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  source: { type: String, enum: SOURCES, required: true },
  trigger: { type: String, enum: ['manual', 'cron'], default: 'manual' },
  // partial: stopped early (time budget or used-up allowance); the rest runs next time.
  status: { type: String, enum: ['running', 'done', 'partial', 'failed'], default: 'running' },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null },
  units: { type: Number, default: 0 },
  unitsDone: { type: Number, default: 0 },
  read: { type: Number, default: 0 },
  created: { type: Number, default: 0 },
  held: { type: Number, default: 0 },
  updated: { type: Number, default: 0 },
  repeats: { type: Number, default: 0 },
  capped: { type: Number, default: 0 },
  dropped: { type: Number, default: 0 },
  credits: { type: Number, default: 0 },
  reasons: { type: Map, of: Number, default: {} },
  error: { type: String, default: null },
}, { versionKey: false });

sourceRunSchema.index({ userId: 1, source: 1, startedAt: -1 });
// Runs are history, not records: a quarter is plenty and keeps the M0 tier small.
sourceRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

const SourceRun = mongoose.model('SourceRun', sourceRunSchema);
module.exports = SourceRun;
Object.assign(module.exports, { SOURCES, STALE_MS });
