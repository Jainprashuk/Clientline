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
const { outreachKeys, forgetOutreach, available: outreachAvailable } = require('../lib/outreachKeys');
const User = require('../models/User');
const SentEmail = require('../models/SentEmail');
const mailer = require('../lib/mailer');
const { hasApp } = require('../lib/apps');

const router = express.Router();

const { AI_PROVIDERS, SEARCH_PROVIDERS } = Settings;
const PROVIDERS = [...AI_PROVIDERS, ...SEARCH_PROVIDERS];
const field = (p) => (AI_PROVIDERS.includes(p) ? `aiKeys.${p}Enc` : `searchKeys.${p}Enc`);
const encOf = (s, p) => (AI_PROVIDERS.includes(p) ? s.aiKeys?.[`${p}Enc`] : s.searchKeys?.[`${p}Enc`]) || '';

const last4 = (enc) => {
  try { const k = credentials.decrypt(enc) || ''; return k ? k.slice(-4) : ''; } catch (_) { return ''; }
};

/**
 * Per provider: whether a key is saved here, and which key is actually in use —
 * this one, or the user's Outreach key (`from: 'outreach'`) when none is saved here.
 */
async function view(userId) {
  const s = await Settings.forUser(userId);
  const status = s.keyStatus ? Object.fromEntries(s.keyStatus) : {};
  const user = await User.findById(userId, { apps: 1 }).lean();
  const canShare = outreachAvailable() && hasApp(user, 'outreach');
  const theirs = canShare ? await outreachKeys(userId) : {};
  const sharing = canShare && s.shareOutreach !== false;
  const one = (p) => {
    const enc = encOf(s, p);
    const fromOutreach = !enc && sharing && !!theirs[p];
    return {
      saved: !!enc,
      inUse: !!enc || fromOutreach,
      from: enc ? 'clientline' : fromOutreach ? 'outreach' : null,
      last4: enc ? last4(enc) : fromOutreach ? theirs[p].slice(-4) : '',
      inOutreach: !!theirs[p],
      status: status[p] || null,
    };
  };
  const ai = Object.fromEntries(AI_PROVIDERS.map(p => [p, one(p)]));
  return {
    ai,
    search: Object.fromEntries(SEARCH_PROVIDERS.map(p => [p, one(p)])),
    usage: await getUsage(userId),
    // Groq carries the volume; the others are backups.
    aiReady: ai.groq.inUse,
    outreach: { canShare, on: sharing, found: PROVIDERS.filter(p => !!theirs[p]) },
    gmail: await gmailView(userId, s),
  };
}

/** The Gmail in use (address only), its settings and today's sends. */
async function gmailView(userId, s) {
  const info = await mailer.senderInfo(userId).catch(() => null);
  return {
    email: info ? info.email : '',
    from: info ? info.from : null,
    savedHere: !!(s.gmailEmail && s.gmailAppPasswordEnc),
    senderName: s.senderName || (info && info.name) || '',
    bookingUrl: s.bookingUrl || '',
    sendsPerDay: s.sendsPerDay || 40,
    sentToday: await SentEmail.sentToday(userId),
    pausedUntil: s.sendingPausedUntil && s.sendingPausedUntil > new Date() ? s.sendingPausedUntil : null,
  };
}

/** The key a provider is using now: saved here, else the Outreach one. '' when none. */
async function keyInUse(userId, provider) {
  const s = await Settings.forUser(userId);
  const enc = encOf(s, provider);
  if (enc) { try { return credentials.decrypt(enc) || ''; } catch (_) { return ''; } }
  if (s.shareOutreach === false) return '';
  return (await outreachKeys(userId))[provider] || '';
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

/** Use (or stop using) the keys saved in Outreach for providers without a key here. */
router.put('/share', async (req, res) => {
  const on = !!(req.body && req.body.on);
  try {
    await Settings.forUser(req.userId);
    await Settings.updateOne({ userId: req.userId }, { $set: { shareOutreach: on } });
    forget(req.userId);
    forgetOutreach(req.userId);
    res.json(await view(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Gmail ───────────────────────────────────────────────────────────────────
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
const isGmailish = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Connect Gmail: the login is checked with Gmail before anything is saved. */
router.put('/gmail', async (req, res) => {
  const email = cleanEmail(req.body && req.body.email);
  // Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of it.
  const appPassword = String((req.body && req.body.appPassword) || '').replace(/\s+/g, '');
  if (!isGmailish(email)) return res.status(400).json({ error: 'Enter your Gmail address.' });
  if (appPassword.length < 12 || appPassword.length > 64) return res.status(400).json({ error: 'That does not look like an app password (16 letters).' });
  try {
    await mailer.verify(email, appPassword);
  } catch (err) {
    return res.status(400).json({ error: mailer.isAuthError(err)
      ? 'Gmail refused that address and app password. Check both — it must be an app password, not your normal Gmail password.'
      : `Could not reach Gmail: ${err.message}` });
  }
  try {
    await Settings.forUser(req.userId);
    const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
    await Settings.updateOne({ userId: req.userId }, { $set: {
      gmailEmail: email, gmailAppPasswordEnc: credentials.encrypt(appPassword), ...(name ? { senderName: name } : {}),
    } });
    res.json(await view(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/gmail', async (req, res) => {
  try {
    await Settings.updateOne({ userId: req.userId }, { $set: { gmailEmail: '', gmailAppPasswordEnc: '' } });
    res.json(await view(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/gmail/test', async (req, res) => {
  try {
    const sender = await mailer.getSender(req.userId);
    if (!sender) return res.status(400).json({ error: 'No Gmail connected.' });
    try { await mailer.verify(sender.email, sender.appPassword); }
    catch (err) { return res.json({ ok: false, error: mailer.isAuthError(err) ? 'Gmail refused the login — the app password may have been revoked.' : err.message, ...(await view(req.userId)) }); }
    res.json({ ok: true, error: null, ...(await view(req.userId)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Sending settings: the name on your emails, booking link, emails per day. */
router.put('/gmail/settings', async (req, res) => {
  const b = req.body || {};
  const $set = {};
  if (typeof b.senderName === 'string') $set.senderName = b.senderName.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (typeof b.bookingUrl === 'string') {
    const u = b.bookingUrl.trim();
    if (u && !/^https?:\/\/\S+$/i.test(u)) return res.status(400).json({ error: 'The booking link must start with https://' });
    $set.bookingUrl = u.slice(0, 300);
  }
  if (b.sendsPerDay !== undefined) $set.sendsPerDay = Math.min(300, Math.max(1, Math.round(Number(b.sendsPerDay) || 40)));
  try {
    await Settings.forUser(req.userId);
    await Settings.updateOne({ userId: req.userId }, { $set });
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
    const key = await keyInUse(req.userId, provider);
    if (!key) return res.status(400).json({ error: 'No key in use for this connection — add one.' });
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
