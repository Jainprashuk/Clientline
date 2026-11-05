/**
 * AI reading of posts, for intent only: is this someone who needs work done, or
 * someone offering it? The two things the text rules get wrong most often
 * (a live run of client posts let job openings and self-promoting freelancers
 * through).
 *
 * The question is who wrote the post, one word from a fixed list, and nothing
 * else, so the model cannot add a fact to a lead: names, budgets, places and
 * emails still come from the text (lib/leads/gates.js). Asking "do they need
 * someone?" rewarded pages that repeat "hire a Next.js developer" and missed a
 * person asking for a recommendation in their own words; asking who is writing
 * separates the two. Batching and parsing follow Outreach's
 * lib/sources/readPosts.js — five posts per call.
 *
 * Without an AI key this does nothing and the rules decide alone.
 */
const { completeChecked, parseJson } = require('../ai/complete');
const { mapLimit } = require('../http');

const PER_CALL = 5;
const MAX_POSTS = 50;
const CHARS = 900;

// client: needs work done · seller: freelancer/agency offering services or looking
// for work · job: a job board or an opening for an employee · article: a blog,
// guide or landing page · discussion: anything else (questions, opinions, news).
const WRITERS = ['client', 'seller', 'job', 'article', 'discussion'];

const SYSTEM = `You sort short web posts for a freelancer looking for clients.
For each post, say who wrote it, as one of:
- "client": a person or company that wants to pay someone outside their team for a piece of work. Includes asking for a recommendation ("looking for a recommendation for a web developer", "can anyone recommend a designer"), "need someone to build X", or looking for a freelancer, contractor or agency.
- "seller": a freelancer, developer or agency offering their services, advertising, "[For Hire]", or looking for work, clients or a sales partner.
- "job": a job board, a list of openings, or a job ad for an employee.
- "article": a blog post, guide, or a company's "hire our developers" page.
- "discussion": anything else — a question, an opinion, advice, news.
Judge by who is writing and what they want, not by which words appear. Return JSON only: {"posts": [{"i": 1, "writer": "client"}, …]} with one entry per post, in order.`;

function check(n) {
  return (text) => {
    const d = parseJson(text);
    if (!d || !Array.isArray(d.posts)) return 'not the JSON asked for';
    const ok = d.posts.filter(p => p && Number.isInteger(p.i) && WRITERS.includes(p.writer));
    if (ok.length < n) return `answered ${ok.length} of ${n} posts`;
    return null;
  };
}

/** Pure: the AI's one word → what the gates read. */
const aiFor = (writer) => ({ writer, needsFreelancer: writer === 'client', selfPromo: writer === 'seller' });

/**
 * Adds item.ai = { writer, needsFreelancer, selfPromo } to the items it could read. Mutates.
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
      if (it && WRITERS.includes(p.writer)) { it.ai = aiFor(p.writer); read++; }
    }
  });
  return { read, noKeys };
}

module.exports = { readPosts, aiFor, SYSTEM, WRITERS, PER_CALL, MAX_POSTS };
