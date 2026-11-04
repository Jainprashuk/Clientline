/**
 * Ask the user's AI chain for text, and only accept an answer that passes the
 * caller's check.
 *
 * The one loop every AI feature goes through (reading posts, writing first
 * lines), following the pattern of Outreach's lib/applyNote.js: try a provider;
 * if it is rate-limited or rejects the key, cool it down and move on; if it
 * answers but the answer fails `check`, ask the same provider once more with
 * the reason, then move on. Nothing is returned that `check` did not pass.
 *
 * `check(text)` returns null when the text is acceptable, or a reason string.
 */
const { chainFor, breakerKeyOf } = require('./providers');
const { blockedIn, coolIn } = require('./breaker');
const { KIND } = require('./providers/kinds');
const { newRunId } = require('../aiCallLog');

// Scope for the cooldowns, so a key that just failed here is skipped for the rest of a run.
const SCOPE = 'clientline';

/**
 * @returns {Promise<{ok: boolean, text: string|null, provider: string|null, error: string|null, noKeys?: boolean}>}
 */
async function completeChecked(userId, { system, prompt, maxTokens, temperature, json }, {
  feature, check = () => null, retries = 1, signal, timeoutMs, context = {},
} = {}) {
  const chain = await chainFor(userId);
  if (!chain.length) return { ok: false, text: null, provider: null, error: 'No AI key — add a free Groq key in Free connections', noKeys: true };

  const runId = newRunId();
  let attempt = 0;
  let lastError = 'every AI provider failed';

  for (const provider of chain) {
    if (blockedIn(SCOPE, provider)) { lastError = `${provider.name} is cooling down`; continue; }
    let ask = prompt;
    for (let round = 0; round <= retries; round++) {
      if (signal && signal.aborted) return { ok: false, text: null, provider: null, error: 'aborted' };
      attempt++;
      const res = await provider.complete(
        { system, prompt: ask, maxTokens, temperature, json },
        { signal, timeoutMs, logAs: { userId, feature, runId, attempt, ...context } },
      );
      if (res.kind !== KIND.OK) {
        coolIn(SCOPE, provider, res);
        lastError = `${provider.name}: ${res.error || res.kind}`;
        break; // next provider
      }
      const reason = check(res.text);
      if (!reason) return { ok: true, text: res.text, provider: provider.name, error: null };
      lastError = `${provider.name} answer rejected: ${reason}`;
      // Tell it what was wrong once; a second miss moves on to the next provider.
      ask = `${prompt}\n\nYour previous answer was rejected because: ${reason}. Answer again and fix that.`;
    }
  }
  return { ok: false, text: null, provider: null, error: lastError };
}

/** Pulls the first JSON object out of a model's answer, tolerating fences and chatter. */
function parseJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
}

module.exports = { completeChecked, parseJson, breakerKeyOf };
