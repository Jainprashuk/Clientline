/**
 * A user's keys saved in Outreach, offered to Clientline so they don't have to
 * add them twice. Read-only: Clientline never writes to Outreach.
 *
 * Outreach keeps AI keys in `settings.aiKeys` and search keys in
 * `discoveryconfigs`, both in its own database (the shared account store that
 * lib/authDb.js already reaches), encrypted with Outreach's CREDENTIAL_KEY. So
 * this needs OUTREACH_CREDENTIAL_KEY — the owner's choice (2026-11-04), knowing
 * that key also decrypts Outreach's stored Gmail app passwords. Only the key
 * fields below are ever read, and only for an account that has Outreach access.
 *
 * Without OUTREACH_CREDENTIAL_KEY set, sharing is simply off.
 *
 * Precedence, per provider (lib/ai/keys.js, lib/searchKeys.js): the key saved
 * in Clientline, else this one if the user left sharing on, else none.
 */
const mongoose = require('mongoose');
const authDb = require('./authDb');
const User = require('../models/User');
const { decryptWith } = require('./credentials');
const { hasApp } = require('./apps');

const AI = ['groq', 'gemini', 'cerebras'];
const SEARCH = ['tavily', 'serpapi'];
const TTL_MS = 60_000;
const cache = new Map(); // userId -> { at, keys }

const available = () => !!process.env.OUTREACH_CREDENTIAL_KEY;

/** provider -> decrypted key ('' when none). Empty object when sharing is impossible. */
async function outreachKeys(userId) {
  if (!available() || !userId || !mongoose.isValidObjectId(userId)) return {};
  const id = String(userId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.keys;

  const keys = {};
  const user = await User.findById(id, { apps: 1 }).lean();
  if (user && hasApp(user, 'outreach')) {
    const oid = new mongoose.Types.ObjectId(id);
    const [settings, discovery] = await Promise.all([
      authDb.collection('settings').findOne({ userId: oid }, { projection: { 'aiKeys.groqEnc': 1, 'aiKeys.geminiEnc': 1, 'aiKeys.cerebrasEnc': 1 } }),
      authDb.collection('discoveryconfigs').findOne({ userId: oid }, { projection: { tavilyEnc: 1, serpapiEnc: 1 } }),
    ]);
    const open = (enc) => { try { return enc ? decryptWith(enc, process.env.OUTREACH_CREDENTIAL_KEY) : ''; } catch (_) { return ''; } };
    for (const p of AI) keys[p] = open(settings && settings.aiKeys && settings.aiKeys[`${p}Enc`]);
    for (const p of SEARCH) keys[p] = open(discovery && discovery[`${p}Enc`]);
  }
  if (cache.size > 1000) cache.clear();
  cache.set(id, { at: Date.now(), keys });
  return keys;
}

function forgetOutreach(userId) { cache.delete(String(userId)); }

module.exports = { outreachKeys, forgetOutreach, available };
