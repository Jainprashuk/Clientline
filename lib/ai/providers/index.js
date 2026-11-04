// The provider chain: ordered, and filtered to the providers this user has a key for.

const gemini = require('./gemini');
const groq = require('./groq');
const cerebras = require('./cerebras');
const { withCallLog } = require('../../aiCallLog');
const { resolveKeys, noteResult } = require('../keys');

// Every call through the chain is recorded (lib/aiCallLog.js).
const ALL = { gemini: withCallLog(gemini), groq: withCallLog(groq), cerebras: withCallLog(cerebras) };

// Groq first, not Gemini. Gemini's free tier is about 20 requests a day on its current
// model, while Groq's is orders of magnitude larger and answers in ~500ms. Gemini stays as
// a backup because those requests are still free; Cerebras is the last resort.
const ORDER = ['groq', 'gemini', 'cerebras'];

// A provider bound to the user's key. breakerKey is per user, so one person's bad or
// exhausted key never cools the provider down for everyone else.
function bind(provider, key, userId) {
  const name = provider.name;
  return {
    ...provider,
    breakerKey: `${name}:${userId}`,
    complete: async (input, opts = {}) => {
      const logAs = { ...((opts && opts.logAs) || {}), keyTail: String(key).slice(-4) };
      const res = await provider.complete(input, { ...opts, apiKey: key, logAs });
      if (res) noteResult(userId, name, res.kind, res.error);
      return res;
    },
  };
}

/** Providers to try for this user, in order, each bound to their key. Empty with no keys. */
async function chainFor(userId) {
  const keys = await resolveKeys(userId);
  return ORDER.filter(name => keys[name]).map(name => bind(ALL[name], keys[name], userId));
}

/** The breaker key for a bound provider. */
const breakerKeyOf = (p) => p.breakerKey || p.name;

module.exports = { ALL, ORDER, chainFor, breakerKeyOf };
