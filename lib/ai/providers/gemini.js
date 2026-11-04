// Gemini, via the official SDK, expressed in the shared provider contract.
// From Outreach's lib/classify/providers/gemini.js, minus its reply classifier.

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { KIND, kindForStatus } = require('./kinds');

const DEFAULT_MODEL = 'gemini-3-flash-preview';

const model = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

// What was sent and what came back, for the AI call log (lib/aiCallLog.js). Rides on
// every result, success or not — a bad answer is exactly the one worth reading in full.
function traceOf(response, err, { system, prompt, params }) {
  const r = response && response.response;
  let output = '';
  try { output = r ? r.text() : ''; } catch (e) { output = `(no text: ${e.message})`; }
  if (!r && err) output = err.message || '';
  const u = r && r.usageMetadata;
  return {
    system, prompt, params, output,
    finishReason: r?.candidates?.[0]?.finishReason || r?.promptFeedback?.blockReason || null,
    tokens: u ? {
      input: u.promptTokenCount ?? null,
      output: u.candidatesTokenCount ?? null,
      thinking: u.thoughtsTokenCount ?? null,
      total: u.totalTokenCount ?? null,
    } : null,
  };
}

// One client per user key. Bounded so a long-lived instance serving many users can't
// grow it forever.
const MAX_CLIENTS = 200;
const clients = new Map();
const getClient = (apiKey) => {
  if (!apiKey) return null;
  let client = clients.get(apiKey);
  if (!client) {
    if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value);
    client = new GoogleGenerativeAI(apiKey);
    clients.set(apiKey, client);
  }
  return client;
};

module.exports = {
  name: 'gemini',
  model,

  // Returns a tagged result, never throws: { kind, text?, error, status, latencyMs }.
  async complete({ system, prompt, maxTokens = 700, temperature = 0.4, json = false }, { timeoutMs = 20000, signal, apiKey } = {}) {
    const startedAt = Date.now();
    const client = getClient(apiKey);
    if (!client) return { kind: KIND.AUTH, status: null, error: 'no Gemini key', latencyMs: 0 };
    const sent = { system, prompt, params: { temperature, maxTokens: maxTokens * 4, json } };
    let response = null;
    try {
      const generative = client.getGenerativeModel({
        model: model(),
        systemInstruction: system,
        // Gemini 3 spends part of maxOutputTokens on its own thinking, so the visible text
        // needs headroom well beyond the answer's length or it stops mid-sentence.
        generationConfig: { maxOutputTokens: maxTokens * 4, temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
      });
      response = await generative.generateContent(prompt, { timeout: timeoutMs, signal });
      const latencyMs = Date.now() - startedAt;
      const trace = traceOf(response, null, sent);
      const text = String(response.response.text() || '').trim();
      if (!text) return { kind: KIND.BAD_OUTPUT, status: 200, error: 'empty response', latencyMs, trace };
      // A cut-off answer is worse than none: it reads fine until the last line.
      if (response.response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        return { kind: KIND.BAD_OUTPUT, status: 200, error: 'answer was cut off (token limit)', latencyMs, trace };
      }
      return { kind: KIND.OK, status: 200, text, latencyMs, error: null, trace };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const trace = traceOf(response, err, sent);
      if (signal && signal.aborted) return { kind: KIND.ABORTED, status: null, error: err.message, latencyMs, trace };
      // The SDK throws with `.status` on an HTTP failure and a plain Error on a timeout or
      // network fault — the message is the only quota signal in the latter case.
      const status = typeof err.status === 'number' ? err.status : null;
      return {
        kind: status === null && !/quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(err.message) ? KIND.TRANSIENT : kindForStatus(status, err.message),
        status, error: err.message, latencyMs, trace,
      };
    }
  },
};
