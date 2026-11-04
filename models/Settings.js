const mongoose = require('mongoose');

/**
 * One account's connections: its own free AI and search keys, what the last
 * call with each said, and this month's search usage. Clientline pays for no
 * API — every call runs on the user's own free key — so this is where all of
 * them live.
 *
 * Keys are stored encrypted (lib/credentials.js, AES-256-GCM) and never leave
 * the server: toJSON drops every *Enc field, and routes/connections.js only
 * ever returns "saved" and the last four characters.
 */
const AI_PROVIDERS = ['groq', 'gemini', 'cerebras'];
const SEARCH_PROVIDERS = ['tavily', 'serpapi'];
// Free monthly allowances, a little under each provider's own so a month never
// ends in a hard refusal from them.
const MONTHLY_CAPS = { tavily: 950, serpapi: 240 };

const keyStatus = new mongoose.Schema({
  // ok · invalid (rejected) · quota (free limit reached)
  state: { type: String, enum: ['ok', 'invalid', 'quota'], required: true },
  checkedAt: { type: Date, required: true },
  error: { type: String, default: null },
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  aiKeys: {
    groqEnc: { type: String, default: '' },
    geminiEnc: { type: String, default: '' },
    cerebrasEnc: { type: String, default: '' },
  },
  searchKeys: {
    tavilyEnc: { type: String, default: '' },
    serpapiEnc: { type: String, default: '' },
  },
  // Keyed by provider: what the last real call with that key said.
  keyStatus: { type: Map, of: keyStatus, default: {} },
  usage: {
    month: { type: String, default: '' }, // YYYY-MM, India time
    tavily: { type: Number, default: 0 },
    serpapi: { type: Number, default: 0 },
  },
}, { timestamps: true });

settingsSchema.index({ userId: 1 }, { unique: true });

settingsSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.aiKeys;
    delete ret.searchKeys;
    return ret;
  },
});

/** The account's row, created on first use. */
settingsSchema.statics.forUser = function forUser(userId) {
  return this.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

const Settings = mongoose.model('Settings', settingsSchema);
module.exports = Settings;
module.exports.AI_PROVIDERS = AI_PROVIDERS;
module.exports.SEARCH_PROVIDERS = SEARCH_PROVIDERS;
module.exports.MONTHLY_CAPS = MONTHLY_CAPS;
