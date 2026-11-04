const mongoose = require('mongoose');

/**
 * One request to an AI provider (Groq, Gemini, Cerebras): what was sent, what
 * came back, how long it took and what it cost in tokens. Written only by
 * lib/aiCallLog.js. From Outreach's models/AiCall.js.
 *
 * One row per ATTEMPT, not per feature call: when Groq is rate-limited and
 * Gemini answers, that is two rows sharing a runId — the failover is exactly
 * what this log exists to show.
 *
 * Rows expire after 30 days: full prompts are large, and the M0 tier is 512 MB.
 */
const FEATURES = ['readposts', 'opener', 'keytest', 'other'];

const aiCallSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // readposts: reading pasted chats / web posts for client intent (lib/leads/readPosts.js)
  // opener: writing a lead's first line (lib/leads/opener.js)
  // keytest: the "Test" button in Free connections
  feature: { type: String, enum: FEATURES, default: 'other' },
  runId: { type: String, default: null },       // shared by every attempt of one feature call
  attempt: { type: Number, default: 1 },
  provider: { type: String, required: true },   // groq | gemini | cerebras
  model: { type: String, default: null },
  keyTail: { type: String, default: null },     // last 4 characters of the key, never the key
  // ok · rate-limited · auth · transient · bad-output · aborted (lib/ai/providers/kinds.js)
  outcome: { type: String, required: true },
  status: { type: Number, default: null },
  latencyMs: { type: Number, default: null },
  error: { type: String, default: null },
  system: { type: String, default: '' },
  prompt: { type: String, default: '' },
  output: { type: String, default: '' },
  finishReason: { type: String, default: null },
  tokens: {
    input: { type: Number, default: null },
    output: { type: Number, default: null },
    thinking: { type: Number, default: null },
    total: { type: Number, default: null },
  },
  params: { type: mongoose.Schema.Types.Mixed, default: null },
  context: {
    leadId: { type: String, default: null },
    company: { type: String, default: null },
  },
  createdAt: { type: Date, default: Date.now },
  expireAt: { type: Date, required: true },
}, { versionKey: false });

aiCallSchema.index({ userId: 1, createdAt: -1 });
aiCallSchema.index({ runId: 1 });
aiCallSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AiCall', aiCallSchema);
module.exports.FEATURES = FEATURES;
