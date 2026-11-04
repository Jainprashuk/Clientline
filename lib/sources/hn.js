/**
 * Hacker News → items, from two monthly threads:
 *
 *  - "Ask HN: Freelancer? Seeking freelancer?" — only its SEEKING FREELANCER
 *    posts. Measured 2026-03…11: nearly every post there is SEEKING WORK (other
 *    freelancers); about one client post in six months.
 *  - "Ask HN: Who is hiring?" — only posts whose first line offers contract,
 *    freelance, part-time or fractional work: 9–18 a month in Oct/Nov 2026.
 *
 * No AI and no key: Algolia's HN API returns a whole thread in one request. The
 * gates (lib/leads/gates.js) then drop what doesn't fit — most "Who is hiring?"
 * posts are region-locked, which the place gate handles.
 *
 * The fetch pattern is from Outreach's lib/sources/hn.js.
 */
const { fetchJson } = require('../http');
const { extractEmails, extractLinks, domainOf, isCompanyEmail } = require('./emails');
const { plain, quote, nameFromDomain } = require('./text');

const API = 'https://hn.algolia.com/api/v1';
const WINDOW_MS = 45 * 24 * 3600 * 1000;
const SEEKING_FREELANCER = /^\s*seeking\s+freelancers?\b/i;
const NON_EMPLOYMENT = /\b(?:contract(?:or|s)?|freelance(?:rs?)?|part[\s-]?time|fractional|1099)\b/i;

/**
 * The threads of the last 45 days matching `title`, newest first, one per month: in a
 * month with two copies, the one with more replies is the real one.
 */
async function threads(query, title, { signal, now = new Date() } = {}) {
  const res = await fetchJson(`${API}/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=12`, { timeoutMs: 10_000, retries: 1, signal });
  if (!res.ok || !res.data || !Array.isArray(res.data.hits)) return { ok: false, error: res.error || 'HN unavailable', threads: [] };
  const byMonth = new Map();
  for (const h of res.data.hits) {
    const t = String(h.title || '');
    if (!title.test(t) || now - (h.created_at_i || 0) * 1000 > WINDOW_MS) continue;
    const month = (t.match(/\(([^)]+)\)\s*$/) || [])[1] || String(h.created_at || '').slice(0, 7);
    const prev = byMonth.get(month);
    if (!prev || (h.num_comments || 0) > prev.comments) byMonth.set(month, { id: String(h.objectID), title: t, comments: h.num_comments || 0, at: h.created_at_i });
  }
  return { ok: true, threads: [...byMonth.values()].sort((a, b) => b.at - a.at) };
}

const freelancerThreads = (opts) => threads('"Freelancer? Seeking freelancer?"', /^ask hn:\s*freelancer\?\s*seeking freelancer\?/i, opts);
const hiringThreads = (opts) => threads('"Who is hiring?"', /^ask hn:\s*who is hiring\?/i, opts);

/** Every top-level comment in a thread. */
async function threadPosts(threadId, { signal } = {}) {
  const res = await fetchJson(`${API}/items/${encodeURIComponent(threadId)}`, { timeoutMs: 25_000, retries: 1, signal });
  if (!res.ok || !res.data) return { ok: false, error: res.error || 'HN unavailable', posts: [] };
  const posts = (res.data.children || [])
    .filter(c => c && c.text && c.type === 'comment')
    .map(c => ({ id: String(c.id), author: c.author || '', html: c.text, createdAt: c.created_at || null }));
  return { ok: true, posts };
}

const PLACE = /remote|onsite|on-site|hybrid|\b[A-Z][a-z]+,\s*[A-Z]{2}\b|india|london|berlin|new york|nyc|europe|\beu\b|usa|\bus\b|\buk\b|canada|anywhere|worldwide|\bgmt|\bcet\b|\best\b|\bpst\b/i;

/** Pure: "Acme | React dev | Remote (EU) | Contract" → { company, role, location, headline }. */
function parseHeader(firstLine, { seeking = false } = {}) {
  const line = seeking ? firstLine.replace(SEEKING_FREELANCER, '').replace(/^[\s:|\-–—]+/, '') : firstLine;
  const fields = line.split(/\s*\|\s*|\s+[-–—]\s+/).map(f => f.trim()).filter(Boolean);
  const location = fields.filter(f => PLACE.test(f)).join(' · ');
  const company = !seeking && fields[0] && fields[0].length <= 80 && !PLACE.test(fields[0]) ? fields[0].replace(/\s*\(.*?\)\s*$/, '') : '';
  const role = !seeking ? (fields.slice(1).find(f => !PLACE.test(f) && !NON_EMPLOYMENT.test(f) && !/^https?:/i.test(f) && f.length <= 120) || '') : '';
  return { company, role, location: location.slice(0, 120), headline: line.slice(0, 200) };
}

/**
 * Pure: posts of one thread → items.
 * kind 'freelancer': SEEKING FREELANCER posts only. kind 'hiring': contract/freelance/part-time roles only.
 * @returns {{ items: object[], read: number, skipped: number }}
 */
function postsToItems(posts, thread, kind) {
  const items = [];
  let skipped = 0;
  const where = `HN · ${String(thread.title || '').replace(/^Ask HN:\s*/i, '')}`;
  for (const p of posts) {
    const hrefs = [...String(p.html || '').matchAll(/href="([^"]+)"/g)].map(m => plain(m[1]));
    const text = plain(p.html);
    const first = text.split('\n')[0];
    const wanted = kind === 'freelancer' ? SEEKING_FREELANCER.test(text) : NON_EMPLOYMENT.test(first);
    if (!wanted) { skipped++; continue; }
    const head = parseHeader(first, { seeking: kind === 'freelancer' });
    const emails = extractEmails(`${text} ${hrefs.filter(h => h.startsWith('mailto:')).join(' ')}`);
    const links = [...new Set([...hrefs.filter(h => /^https?:/i.test(h)), ...extractLinks(text)])]
      .filter(u => !/news\.ycombinator\.com/i.test(u));
    const company = emails.find(isCompanyEmail);
    let domain = company ? domainOf(company) : null;
    if (!domain && links[0]) { try { domain = new URL(links[0]).hostname.replace(/^www\./, ''); } catch (_) { /* not a URL */ } }
    const url = `https://news.ycombinator.com/item?id=${p.id}`;
    const at = p.createdAt ? new Date(p.createdAt) : null;
    items.push({
      source: 'hn',
      sourceType: 'asked',
      // Both kinds are someone offering paid work, by what the thread section means.
      needsByConstruction: true,
      text,
      name: head.company || (domain ? nameFromDomain(domain) : `HN user ${p.author}`),
      person: '',
      title: head.role,
      domain,
      location: head.location,
      emails: emails.map(email => ({ email, confidence: 'high' })),
      url,
      where,
      postedAt: at,
      about: text.slice(0, 1500),
      signals: [{ text: quote(kind === 'freelancer' ? head.headline || text : first), source: where, url, at }],
    });
  }
  return { items, read: posts.length, skipped };
}

/** One run's work: every thread to read. */
async function plan({ signal, now } = {}) {
  const [f, h] = await Promise.all([freelancerThreads({ signal, now }), hiringThreads({ signal, now })]);
  if (!f.ok && !h.ok) return { error: f.error || h.error, units: [] };
  return {
    error: null,
    units: [
      ...f.threads.map(t => ({ kind: 'freelancer', id: t.id, title: t.title })),
      // The newest "Who is hiring?" only: it has 200+ posts and the older one is mostly filled.
      ...h.threads.slice(0, 1).map(t => ({ kind: 'hiring', id: t.id, title: t.title })),
    ],
  };
}

/** One unit → items. */
async function collect(unit, { signal } = {}) {
  const r = await threadPosts(unit.id, { signal });
  if (!r.ok) return { error: r.error, items: [], read: 0 };
  const { items, read } = postsToItems(r.posts, unit, unit.kind);
  return { error: null, items, read };
}

module.exports = { plan, collect, freelancerThreads, hiringThreads, threadPosts, postsToItems, parseHeader, SEEKING_FREELANCER, NON_EMPLOYMENT };
