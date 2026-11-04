// Each user's search keys and free monthly allowances (models/Settings.js).
// From Outreach's lib/discovery/usage.js.

const Settings = require('../models/Settings');
const credentials = require('./credentials');

const { SEARCH_PROVIDERS: PROVIDERS, MONTHLY_CAPS } = Settings;

/** YYYY-MM in India time, so the allowance rolls over at local midnight. */
function monthKey(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
}

/** The decrypted keys, '' for any not set (or that no longer decrypts). */
async function loadKeys(userId) {
  const doc = await Settings.findOne({ userId }, { searchKeys: 1 }).lean();
  const keys = {};
  for (const p of PROVIDERS) {
    const enc = doc && doc.searchKeys && doc.searchKeys[`${p}Enc`];
    try { keys[p] = enc ? credentials.decrypt(enc) : ''; } catch (_) { keys[p] = ''; }
  }
  return keys;
}

/** Usage this month, with last month's counts already rolled over to zero. */
async function getUsage(userId) {
  const doc = await Settings.findOne({ userId }, { usage: 1 }).lean();
  const month = monthKey();
  const u = doc && doc.usage && doc.usage.month === month ? doc.usage : { month, tavily: 0, serpapi: 0 };
  return { month, tavily: u.tavily || 0, serpapi: u.serpapi || 0, caps: MONTHLY_CAPS };
}

/**
 * Spend `n` of a provider's free monthly allowance. Atomic: two searches racing for
 * the last credit can't both get it. Returns false when the allowance is used up.
 */
async function take(userId, provider, n = 1) {
  const cap = MONTHLY_CAPS[provider];
  if (cap === undefined) return true;
  const month = monthKey();
  await Settings.updateOne(
    { userId, 'usage.month': { $ne: month } },
    { $set: { usage: { month, tavily: 0, serpapi: 0 } } },
  );
  const r = await Settings.updateOne(
    { userId, 'usage.month': month, [`usage.${provider}`]: { $lte: cap - n } },
    { $inc: { [`usage.${provider}`]: n } },
  );
  return r.modifiedCount === 1;
}

module.exports = { monthKey, loadKeys, getUsage, take, PROVIDERS, MONTHLY_CAPS };
