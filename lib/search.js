// Web search on the user's own key: Tavily first (1,000 free credits a month), SerpApi as
// the backup (250 a month). Each query spends one credit of the user's own allowance.
// From Outreach's lib/discovery/search.js — only the plain web search and the recent-posts
// search; Clientline never searches LinkedIn profiles.

const { postJson, fetchJson } = require('./http');
const usage = require('./searchKeys');

const NO_KEY = 'No search key — add a free Tavily key in Free connections';

function describe(provider, res) {
  if (res.status === 401 || res.status === 403) return `${provider} rejected the key — check it in Free connections`;
  if (res.status === 429 || res.status === 432) return `${provider} free allowance used up`;
  return `${provider}: ${res.error || 'request failed'}`;
}

async function tavilyWeb(key, query, signal) {
  const res = await postJson('https://api.tavily.com/search', {
    timeoutMs: 15_000,
    signal,
    headers: { authorization: `Bearer ${key}` },
    body: { query, search_depth: 'basic', max_results: 10 },
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const rows = (res.data && res.data.results) || [];
  return { ok: true, results: rows.map(r => ({ title: r.title || '', url: r.url || '', snippet: r.content || '' })) };
}

async function serpapiWeb(key, query, signal) {
  const res = await fetchJson(`https://serpapi.com/search.json?engine=google&num=10&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(key)}`, {
    timeoutMs: 20_000, retries: 0, signal,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const rows = (res.data && res.data.organic_results) || [];
  return { ok: true, results: rows.map(r => ({ title: r.title || '', url: r.link || '', snippet: r.snippet || '' })) };
}

/**
 * One plain web search (e.g. a funded company's own website).
 * @returns {Promise<{ok: boolean, results: object[], provider: string|null, error: string|null}>}
 */
async function webSearch({ userId, keys, query, signal }) {
  let error = NO_KEY;
  for (const [p, fn] of [['tavily', tavilyWeb], ['serpapi', serpapiWeb]]) {
    if (!keys[p]) continue;
    if (!(await usage.take(userId, p))) { error = `${p} monthly allowance used up`; continue; }
    const res = await fn(keys[p], query, signal);
    if (res.ok) return { ok: true, results: res.results, provider: p, error: null };
    error = describe(p, res);
  }
  return { ok: false, results: [], provider: null, error };
}

// Where clients post that they need someone: public posts only, from the last week.
const POST_DOMAINS = ['linkedin.com', 'x.com', 'twitter.com', 'reddit.com', 'indiehackers.com'];

async function tavilyPosts(key, query, signal) {
  const send = (extra) => postJson('https://api.tavily.com/search', {
    timeoutMs: 15_000,
    signal,
    headers: { authorization: `Bearer ${key}` },
    body: { query, search_depth: 'basic', max_results: 20, include_domains: POST_DOMAINS, include_raw_content: true, ...extra },
  });
  let res = await send({ time_range: 'week' });
  // An older API that doesn't know time_range answers 400: ask again without it
  // (still one credit — a rejected request isn't billed).
  if (!res.ok && res.status === 400) res = await send({});
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const rows = (res.data && res.data.results) || [];
  return {
    ok: true,
    // raw_content: the page's own text (no extra credit at basic depth), so a first line
    // can use what the post actually says, not just the snippet.
    results: rows.map(r => ({ title: r.title || '', url: r.url || '', snippet: r.content || '', page: String(r.raw_content || '').slice(0, 20_000), publishedAt: r.published_date || null })),
  };
}

async function serpapiPosts(key, query, signal) {
  const q = `${query} (site:linkedin.com/posts OR site:x.com OR site:reddit.com OR site:indiehackers.com)`;
  const res = await fetchJson(`https://serpapi.com/search.json?engine=google&num=20&tbs=qdr:w&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`, {
    timeoutMs: 20_000, retries: 0, signal,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const rows = (res.data && res.data.organic_results) || [];
  return { ok: true, results: rows.map(r => ({ title: r.title || '', url: r.link || '', snippet: r.snippet || '', publishedAt: null })) };
}

/**
 * One search for recent public posts.
 * @returns {Promise<{ok: boolean, results: object[], provider: string|null, credits: number, error: string|null, stop: boolean}>}
 * `stop` is true when no provider can serve another query this run (no key, rejected, used up).
 */
async function postSearch({ userId, keys, query, signal }) {
  let error = NO_KEY;
  let credits = 0;
  let usable = 0;
  for (const [p, fn] of [['tavily', tavilyPosts], ['serpapi', serpapiPosts]]) {
    if (!keys[p]) continue;
    if (!(await usage.take(userId, p))) { error = `${p} monthly allowance used up`; continue; }
    credits++;
    const res = await fn(keys[p], query, signal);
    if (res.ok) return { ok: true, results: res.results, provider: p, credits, error: null, stop: false };
    error = describe(p, res);
    if (![401, 403, 429, 432].includes(res.status)) usable++;
  }
  return { ok: false, results: [], provider: null, credits, error, stop: usable === 0 };
}

/** One cheap call to check a key works (Free connections → Test). Spends one credit. */
async function testSearchKey(provider, key) {
  const fn = provider === 'tavily' ? tavilyWeb : serpapiWeb;
  const res = await fn(key, 'freelance developer', undefined);
  return res.ok ? { ok: true, error: null } : { ok: false, error: describe(provider, res) };
}

module.exports = { webSearch, postSearch, testSearchKey, POST_DOMAINS };
