/**
 * Whose AI key a call runs on: always the user's own. Clientline has no owner
 * keys to fall back to — the free-only rule means every AI call is paid for by
 * the user's own free allowance, or not made.
 *
 * Adapted from Outreach's lib/ai/keys.js without its rollout switch, grace
 * period and owner fallback, and with one key per provider.
 *
 * Cached briefly per instance: a run reads the same user's keys for every batch.
 */
const mongoose = require('mongoose');
const Settings = require('../../models/Settings');
const credentials = require('../credentials');
const { outreachKeys } = require('../outreachKeys');

const { AI_PROVIDERS: PROVIDERS } = Settings;
const LABEL = { gemini: 'Gemini', groq: 'Groq', cerebras: 'Cerebras' };
const TTL_MS = 30_000;

const cache = new Map(); // userId -> { at, keys }

/**
 * The decrypted keys, provider -> key or ''. A key saved here wins; otherwise the
 * user's Outreach key when they left sharing on. A key that no longer decrypts
 * counts as not saved.
 */
async function resolveKeys(userId) {
  if (!userId || !mongoose.isValidObjectId(userId)) return {};
  const id = String(userId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.keys;
  const s = await Settings.findOne({ userId: id }, { aiKeys: 1, shareOutreach: 1 }).lean();
  const shared = s && s.shareOutreach === false ? {} : await outreachKeys(id);
  const keys = {};
  for (const p of PROVIDERS) {
    const enc = s && s.aiKeys && s.aiKeys[`${p}Enc`];
    try { keys[p] = enc ? credentials.decrypt(enc) || '' : ''; } catch (_) { keys[p] = ''; }
    if (!keys[p] && shared[p]) keys[p] = shared[p];
  }
  if (cache.size > 1000) cache.clear();
  cache.set(id, { at: Date.now(), keys });
  return keys;
}

/** Forget what this instance cached for a user — after they save or remove a key. */
function forget(userId) { cache.delete(String(userId)); }

const STATE_FOR = { ok: 'ok', auth: 'invalid', 'rate-limited': 'quota' };
const lastNoted = new Map(); // `${userId}:${provider}` -> `${state}:${day}`
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records what a real call said about a user's key, so Free connections can show
 * Working / Rejected / Daily limit reached. Never throws. Writes only when the
 * state changes or a new day starts, so a run of fifty calls is one write.
 */
async function noteResult(userId, provider, kind, error) {
  try {
    const state = STATE_FOR[kind];
    if (!state || !userId) return;
    const memo = `${userId}:${provider}`;
    const stamp = `${state}:${today()}`;
    if (lastNoted.get(memo) === stamp) return;
    lastNoted.set(memo, stamp);
    if (lastNoted.size > 5000) lastNoted.clear();
    await Settings.updateOne({ userId }, {
      $set: { [`keyStatus.${provider}`]: { state, checkedAt: new Date(), error: state === 'ok' ? null : String(error || '').slice(0, 300) } },
    });
  } catch (err) {
    console.error('[ai/keys] noteResult failed:', err.message);
  }
}

/** Is any AI available to this account? Groq is the one that matters: it carries the volume. */
async function aiReady(userId) {
  const keys = await resolveKeys(userId);
  return { ready: !!keys.groq, any: PROVIDERS.some(p => !!keys[p]) };
}

module.exports = { PROVIDERS, LABEL, resolveKeys, forget, noteResult, aiReady };
