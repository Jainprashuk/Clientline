/**
 * AI reading of posts, for intent only: is this someone who needs work done, or
 * someone offering it? The two things the text rules get wrong most often
 * (a live run of client posts let job openings and self-promoting freelancers
 * through).
 *
 * The answer is two booleans per post and nothing else, so the model cannot add
 * a fact to a lead: names, budgets, places and emails still come from the text
 * (lib/leads/gates.js). Batching and parsing follow Outreach's
 * lib/sources/readPosts.js — five posts per call.
 *
 * Without an AI key this does nothing and the rules decide alone.
 */
const { completeChecked, parseJson } = require('../ai/complete');
const { mapLimit } = require('../http');

const PER_CALL = 5;
const MAX_POSTS = 30;
const CHARS = 900;

const SYSTEM = `You sort short posts for a freelancer looking for clients.
For each post decide:
- needsFreelancer: true only if the writer wants to pay someone outside their company to do a piece of work (a freelancer, contractor, agency, or "someone who can build/design/fix X"). A job opening for an employee is false.
- selfPromo: true if the writer is offering their own (or their agency's) services, or looking for work.
Return JSON only: {"posts": [{"i": 1, "needsFreelancer": true, "selfPromo": false}, …]} with one entry per post, in order.`;

function check(n) {
  return (text) => {
    const d = parseJson(text);
    if (!d || !Array.isArray(d.posts)) return 'not the JSON asked for';
    const ok = d.posts.filter(p => p && Number.isInteger(p.i) && typeof p.needsFreelancer === 'boolean' && typeof p.selfPromo === 'boolean');
    if (ok.length < n) return `answered ${ok.length} of ${n} posts`;
    return null;
  };
}

/**
 * Adds item.ai = { needsFreelancer, selfPromo } to the items it could read. Mutates.
 * @returns {Promise<{read: number, noKeys: boolean}>}
 */
async function readPosts(userId, items, { signal } = {}) {
  const todo = items.filter(i => i.sourceType === 'asked' && !i.needsByConstruction && !i.ai).slice(0, MAX_POSTS);
  if (!todo.length) return { read: 0, noKeys: false };
  const batches = [];
  for (let i = 0; i < todo.length; i += PER_CALL) batches.push(todo.slice(i, i + PER_CALL));
  let read = 0; let noKeys = false;
  await mapLimit(batches, 2, async (batch) => {
    if (noKeys) return;
    const prompt = batch.map((it, n) => `POST ${n + 1}:\n${String(it.text || '').slice(0, CHARS)}`).join('\n\n');
    const r = await completeChecked(userId, { system: SYSTEM, prompt, maxTokens: 60 * batch.length, temperature: 0, json: true },
      { feature: 'readposts', check: check(batch.length), signal });
    if (r.noKeys) { noKeys = true; return; }
    if (!r.ok) return; // the rules decide for this batch
    for (const p of parseJson(r.text).posts) {
      const it = batch[p.i - 1];
      if (it) { it.ai = { needsFreelancer: p.needsFreelancer, selfPromo: p.selfPromo }; read++; }
    }
  });
  return { read, noKeys };
}

module.exports = { readPosts, PER_CALL, MAX_POSTS };
