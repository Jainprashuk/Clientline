/**
 * Free connections: the user's own AI and search keys.
 *
 * A key is tested with one real call before it is saved, so a typo is caught on
 * the page rather than surfacing later as "no leads". A key that is valid but
 * out of today's allowance is still saved — it will work tomorrow.
 *
 * Keys go in encrypted and never come back out: responses carry "saved", the
 * last four characters and what the last call said.
 */
const express = require('express');
const Settings = require('../models/Settings');
const credentials = require('../lib/credentials');
const { ALL } = require('../lib/ai/providers');
const { KIND } = require('../lib/ai/providers/kinds');
const { forget, noteResult } = require('../lib/ai/keys');
const { getUsage } = require('../lib/searchKeys');
const { testSearchKey } = require('../lib/search');

const router = express.Router();

const { AI_PROVIDERS, SEARCH_PROVIDERS } = Settings;
const PROVIDERS = [...AI_PROVIDERS, ...SEARCH_PROVIDERS];
const field = (p) => (AI_PROVIDERS.includes(p) ? `aiKeys.${p}Enc` : `searchKeys.${p}Enc`);
const encOf = (s, p) => (AI_PROVIDERS.includes(p) ? s.aiKeys?.[`${p}Enc`] : s.searchKeys?.[`${p}Enc`]) || '';

const last4 = (enc) => {
  try { const k = credentials.decrypt(enc) || ''; return k ? k.slice(-4) : ''; } catch (_) { return ''; }
};

async function view(userId) {
  const s = await Settings.forUser(userId);
  const status = s.keyStatus ? Object.fromEntries(s.keyStatus) : {};
  const one = (p) => {
    const enc = encOf(s, p);
    return { saved: !!enc, last4: enc ? last4(enc) : '', status: status[p] || null };
  };
  return {
    ai: Object.fromEntries(AI_PROVIDERS.map(p => [p, one(p)])),
    search: Object.fromEntries(SEARCH_PROVIDERS.map(p => [p, one(p)])),
    usage: await getUsage(userId),
    // Groq carries the volume; the others are backups.
    aiReady: !!encOf(s, 'groq'),
  };
}

/** One tiny call with this key. Resolves { ok, kind, error }. */
async function testKey(userId, provider, key) {
  if (SEARCH_PROVIDERS.includes(provider)) {
    const r = await testSearchKey(provider, key);
    return { ok: r.ok, kind: r.ok ? KIND.OK : KIND.AUTH, error: r.error };
  }
  const res = await ALL[provider].complete(
    { system: 'Reply with the single word: ok', prompt: 'ok', maxTokens: 10, temperature: 0 },
    { apiKey: key, timeoutMs: 15000, logAs: { userId, feature: 'keytest', keyTail: key.slice(-4) } },
  );
  return { ok: res.kind === KIND.OK, kind: res.kind, error: res.error };
}

const validKey = (k) => typeof k === 'string' && k.trim().length >= 10 && k.trim().length <= 300 && !/\s/.test(k.trim());

router.get('/', async (req, res) => {
  try {
    res.json(await view(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Unknown connection' });
  const key = req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '';
  if (!validKey(key)) return res.status(400).json({ error: 'That does not look like an API key.' });
  try {
    const t = await testKey(req.userId, provider, key);
    // Rejected outright: don't save something that will never work.
    if (!t.ok && t.kind === KIND.AUTH) {
      return res.status(400).json({ error: t.error ? `The key was rejected: ${t.error}`.slice(0, 300) : 'The key was rejected.' });
    }
    await Settings.forUser(req.userId);
    await Settings.updateOne({ userId: req.userId }, { $set: { [field(provider)]: credentials.encrypt(key) } });
    forget(req.userId);
    if (AI_PROVIDERS.includes(provider)) await noteResult(req.userId, provider, t.kind, t.error);
    else await Settings.updateOne({ userId: req.userId }, { $set: { [`keyStatus.${provider}`]: { state: t.ok ? 'ok' : 'quota', checkedAt: new Date(), error: t.ok ? null : String(t.error || '').slice(0, 300) } } });
    const warning = t.ok ? null : `Saved, but the test call did not succeed: ${t.error || t.kind}`;
    res.json({ ...(await view(req.userId)), warning });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:provider/test', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Unknown connection' });
  try {
    const s = await Settings.forUser(req.userId);
    const enc = encOf(s, provider);
    if (!enc) return res.status(400).json({ error: 'No key saved for this connection.' });
    let key = '';
    try { key = credentials.decrypt(enc); } catch (_) { /* rotated CREDENTIAL_KEY */ }
    if (!key) return res.status(400).json({ error: 'The saved key can no longer be read — add it again.' });
    const t = await testKey(req.userId, provider, key);
    const state = t.ok ? 'ok' : t.kind === KIND.AUTH ? 'invalid' : 'quota';
    await Settings.updateOne({ userId: req.userId }, { $set: { [`keyStatus.${provider}`]: { state, checkedAt: new Date(), error: t.ok ? null : String(t.error || '').slice(0, 300) } } });
    res.json({ ok: t.ok, error: t.ok ? null : t.error, ...(await view(req.userId)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Unknown connection' });
  try {
    await Settings.updateOne({ userId: req.userId }, { $set: { [field(provider)]: '' }, $unset: { [`keyStatus.${provider}`]: 1 } });
    forget(req.userId);
    res.json(await view(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
