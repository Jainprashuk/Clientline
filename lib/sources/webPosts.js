/**
 * Client posts on the public web → items. People write "looking for a freelance
 * React developer" on LinkedIn, X, Reddit and Indie Hackers; a search on the
 * user's own Tavily (or SerpApi) key finds last week's.
 *
 * The engine is Outreach's lib/sources/webPosts.js — daily-rotated query
 * templates × the user's keywords, one credit per query — with templates that
 * look for someone who needs work done instead of someone hiring an employee.
 * A post without an email is still a lead (held): you can answer it where it was
 * posted.
 */
const { postSearch } = require('../search');
const { extractEmails, domainOf, isCompanyEmail } = require('./emails');
const { quote, nameFromDomain } = require('./text');

// {kw} is one of the user's service keywords.
const TEMPLATES = [
  '"looking for a freelance" {kw}',
  '"looking for a freelancer" {kw}',
  '"need a" {kw} freelancer',
  '"hiring a freelance" {kw}',
  '"recommend a" {kw} freelancer OR agency',
  '"looking for" {kw} contractor',
];

/** Pure: today's queries — keywords × templates, rotated by day so a week covers them all. */
function buildQueries(profile = {}, perDay = 5, day = Math.floor(Date.now() / 86400000)) {
  const kws = [...new Set((profile.services || []).flatMap(s => (s.keywords || []).slice(0, 4)))].slice(0, 12);
  if (!kws.length) return [];
  const all = [];
  for (const t of TEMPLATES) for (const kw of kws) all.push(t.replace('{kw}', kw.includes(' ') ? `"${kw}"` : kw));
  const start = (day * perDay) % all.length;
  return [...all.slice(start), ...all.slice(0, start)].slice(0, Math.min(perDay, all.length));
}

const SITE_LABEL = [
  [/linkedin\.com/i, 'LinkedIn post'], [/(?:\/\/|\.)x\.com|twitter\.com/i, 'Post on X'],
  [/reddit\.com/i, 'Reddit post'], [/indiehackers\.com/i, 'Indie Hackers post'],
];
const siteLabel = (url) => (SITE_LABEL.find(([re]) => re.test(url)) || [null, 'Web post'])[1];

/** Pure: who wrote it, from how each site titles its posts. */
function authorOf(title, url) {
  const t = String(title || '');
  if (/linkedin\.com/i.test(url)) {
    const m = t.match(/^(.{2,60}?)\s+(?:on LinkedIn|’s Post|'s Post|posted on)/i) || t.match(/^(.{2,60}?)\s+[-|]\s+LinkedIn/i);
    return m ? m[1].trim() : '';
  }
  if (/(?:\/\/|\.)x\.com|twitter\.com/i.test(url)) {
    const m = t.match(/^(.{2,60}?)\s+(?:on X|on Twitter)\b/i);
    return m ? m[1].trim() : '';
  }
  return '';
}

// Job boards and job pages: openings for employees, not people needing work done.
const JOB_PAGE = /linkedin\.com\/jobs|\/jobs?\/view|indeed\.|glassdoor\.|naukri\.com|wellfound\.com\/jobs|\/careers?\//i;

const plain = (s) => String(s || '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // markdown images
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // markdown links → their text
  .replace(/[#*_>`|]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Pure: the post's own words from the page text — the stretch around where the
 * snippet appears, so login walls, menus and other people's posts are left out.
 * '' when the page doesn't contain the snippet (then it isn't the post we found).
 */
function postText(page, snippet, max = 1500) {
  const p = plain(page); const s = plain(snippet);
  if (!p || s.length < 30) return '';
  const probe = s.slice(0, 40).toLowerCase();
  const at = p.toLowerCase().indexOf(probe);
  if (at < 0) return '';
  // Back to the start of the snippet's sentence when that is close; else the snippet itself.
  const before = p.slice(Math.max(0, at - 150), at);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
  const start = cut >= 0 ? at - before.length + cut + 2 : at;
  const out = p.slice(start, start + max).trim();
  return out.length > s.length ? out : '';
}

/** Pure: search results → items. */
function resultsToItems(results) {
  const items = [];
  for (const r of results || []) {
    if (!r.url || JOB_PAGE.test(r.url)) continue;
    const text = `${r.title || ''}\n${r.snippet || ''}`.trim();
    const emails = extractEmails(text);
    const company = emails.find(isCompanyEmail);
    const domain = company ? domainOf(company) : null;
    const person = authorOf(r.title, r.url);
    const label = siteLabel(r.url);
    const at = r.publishedAt ? new Date(r.publishedAt) : null;
    const full = postText(r.page, r.snippet);
    items.push({
      source: 'web-post',
      sourceType: 'asked',
      text,
      name: domain ? nameFromDomain(domain) : (person || label),
      person,
      domain,
      emails: emails.map(email => ({ email, confidence: 'high' })),
      url: r.url,
      where: full ? label : `${label} (search snippet)`,
      postedAt: at && !Number.isNaN(at.getTime()) ? at : null,
      about: (full || String(r.snippet || '')).slice(0, 1500),
      signals: [{ text: quote(r.snippet || r.title), source: `${label} via web search`, url: r.url, at: at && !Number.isNaN(at.getTime()) ? at : null }],
    });
  }
  return items;
}

/** One run's work: today's queries. Needs a search key and keywords. */
async function plan({ profile, keys, now = new Date() } = {}) {
  if (!keys || (!keys.tavily && !keys.serpapi)) return { error: 'Add a free Tavily key in Free connections to search client posts', units: [] };
  const perDay = (profile && profile.sources && profile.sources.webPerDay) || 5;
  const queries = buildQueries(profile, perDay, Math.floor(now.getTime() / 86400000));
  if (!queries.length) return { error: 'Add keywords to your services in My profile', units: [] };
  return { error: null, units: queries.map(q => ({ query: q })) };
}

/** One query → items. `stop` tells the runner no provider can serve another query. */
async function collect(unit, { userId, keys, signal } = {}) {
  const r = await postSearch({ userId, keys, query: unit.query, signal });
  if (!r.ok) return { error: r.error, stop: r.stop, items: [], read: 0, credits: r.credits };
  return { error: null, items: resultsToItems(r.results), read: r.results.length, credits: r.credits };
}

module.exports = { postText, plan, collect, buildQueries, resultsToItems, authorOf, TEMPLATES };
