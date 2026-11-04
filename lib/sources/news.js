/**
 * Funding news → items. A company that just raised money has budget and a
 * reason to move fast: the trigger-type lead (sourceType 'trigger').
 *
 *   plan    — Google News RSS searches built from the profile (client types ×
 *             places), one unit each; GDELT when Google News doesn't answer.
 *   collect — funding headlines → company names → their website (a Tavily
 *             search when the user has a key, else a few likely domains checked
 *             by fetching them) → contact emails read off the site.
 *
 * Free and keyless apart from the optional Tavily search. Every signal links
 * to its article. The headline rules (isFunding, parseRss, the publisher
 * suffix) are from Outreach's lib/discovery/enrich/news.js; the site scan is
 * Outreach's lib/discovery/website.js.
 */
const { fetchText, fetchJson, mapLimit } = require('../http');
const { scanWebsite, pageTitle, htmlToText } = require('./website');
const { webSearch } = require('../search');
const { plain } = require('./text');

const WINDOW_DAYS = 21;
const PER_UNIT = 4;               // companies looked up per search, so a unit stays well under a minute
const MAX_UNITS = 3;

// ── Headlines (from Outreach) ───────────────────────────────────────────────
const FUNDING_VERB = /\b(raises?|raised|raising|secures?|secured|bags?|bagged|closes?|closed|lands?|landed|gets?|announces?|nets?|picks up|scoops?)\b/i;
const FUNDING_WORD = /\b(series [a-f]|seed|pre-seed|pre-series|funding|fundraise|investment|round|investors?|backed)\b/i;
const MONEY_FROM = /(\$|₹|\brs\.?\s?\d|\b(inr|usd)\b|\b\d+(\.\d+)?\s?(m|mn|million|bn|billion|cr|crore|lakh)\b)[^,;]*\b(from|led by|in a round)\b/i;
const NOT_FUNDING = /\b(prices?|fees?|minimum order|order value|interest rates?|tariffs?|salar(y|ies)|bar|concerns?|questions?|awareness|stake in)\b/i;
const DIRECTORY = /\b(funding rounds?\s*(&|and)\s*|list of investors|investors list|company profile|competitors|valuation history|cap table)\b/i;
const LAYOFFS = /\b(lay ?offs?|lays off|laid off|job cuts|hiring freeze|shuts? down|shutdown)\b/i;
const isFunding = (t) => FUNDING_VERB.test(t) && (FUNDING_WORD.test(t) || MONEY_FROM.test(t)) && !DIRECTORY.test(t) && !NOT_FUNDING.test(t) && !LAYOFFS.test(t);

/** Google News titles end in " - Publisher". */
function splitPublisher(t) {
  const m = plain(t).match(/^(.*?)\s+-\s+([^-]{2,60})$/);
  return m ? { title: m[1], publisher: m[2] } : { title: plain(t), publisher: '' };
}

/** Pure: the RSS feed's items. */
function parseRss(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => (m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    const { title, publisher } = splitPublisher(get('title'));
    items.push({ title, publisher: plain(get('source')) || publisher, url: plain(get('link')), at: new Date(plain(get('pubDate'))) });
  }
  return items;
}

/** Pure: GDELT's article list. seendate looks like 20261003T101500Z. */
function parseGdelt(data) {
  const rows = (data && Array.isArray(data.articles)) ? data.articles : [];
  return rows.map(a => {
    const s = String(a.seendate || '');
    const iso = s.length >= 15 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z` : '';
    return { title: plain(a.title), publisher: String(a.domain || ''), url: String(a.url || ''), at: new Date(iso) };
  });
}

// ── Company name from a headline ────────────────────────────────────────────
// Words that describe a company rather than name it ("Bengaluru-based AI startup Acme").
const NOT_NAME = new Set(`a an the this its exclusive breaking update report india indian us uk startup startups firm company platform
  fintech edtech healthtech agritech proptech insurtech saas ai d2c brand app maker unicorn co founder founders ceo
  raises raised secures bags closes gets announces funding round seed series`.split(/\s+/).filter(Boolean));

/**
 * Pure: "Bengaluru-based AI startup Acme Labs raises $2M seed" → "Acme Labs".
 * The subject before the funding verb, keeping its trailing run of Capitalised words.
 * null when no plausible name is there.
 */
function companyFromHeadline(title) {
  const t = String(title || '').replace(/^[^:]{1,25}:\s+/, ''); // "Exclusive: …"
  const verb = t.match(FUNDING_VERB);
  if (!verb || verb.index === 0) return null;
  const subject = t.slice(0, verb.index).trim().replace(/[,'’]s?$/, '');
  const words = subject.split(/\s+/);
  const name = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].replace(/[“”"(),]/g, '');
    if (!/^[A-Z0-9][\w.&+-]*$/.test(w) || /-based$/i.test(w) || NOT_NAME.has(w.toLowerCase())) break;
    name.unshift(w);
    if (name.length === 4) break;
  }
  const out = name.join(' ').trim();
  return out.length >= 2 && out.length <= 50 ? out : null;
}

// ── Queries from the profile ────────────────────────────────────────────────
const TYPE_TERMS = {
  startups: 'startup', saas: 'SaaS startup', ecommerce: 'D2C brand', 'local-business': 'startup',
  agencies: 'agency', nonprofit: 'startup', enterprise: 'company',
};
const PLACE_TERMS = { india: 'India', us: 'US', uk: 'UK', europe: 'Europe', canada: 'Canada', australia: 'Australia', uae: 'UAE', singapore: 'Singapore' };

/** Pure: up to MAX_UNITS searches for this profile. */
function buildQueries(profile = {}) {
  const types = [...new Set((profile.clientTypes || []).map(t => TYPE_TERMS[t]).filter(Boolean))];
  // "remote" is how they work, not where a company is.
  const places = (profile.locations || []).filter(l => !/^(remote|anywhere|worldwide|global)$/i.test(l))
    .map(l => PLACE_TERMS[l] || (l.length <= 30 ? l : null)).filter(Boolean);
  const t = types.length ? types : ['startup'];
  const p = places.length ? places : [''];
  const out = [];
  for (const place of p) for (const type of t) {
    out.push(`${type} (raises OR secures OR bags) (seed OR "pre-seed" OR "series a" OR funding) ${place}`.replace(/\s+/g, ' ').trim());
  }
  return [...new Set(out)].slice(0, MAX_UNITS);
}

const GN_LOCALE = { India: 'hl=en-IN&gl=IN&ceid=IN:en', UK: 'hl=en-GB&gl=GB&ceid=GB:en', Australia: 'hl=en-AU&gl=AU&ceid=AU:en', Canada: 'hl=en-CA&gl=CA&ceid=CA:en' };

async function headlines(query, { signal }) {
  const place = Object.keys(GN_LOCALE).find(p => query.endsWith(` ${p}`));
  const locale = GN_LOCALE[place] || 'hl=en-US&gl=US&ceid=US:en';
  const rss = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${WINDOW_DAYS}d`)}&${locale}`,
    { timeoutMs: 8_000, maxBytes: 2 * 1024 * 1024, signal });
  if (rss.ok && /<rss|<channel/i.test(rss.data || '')) return { ok: true, via: 'Google News', articles: parseRss(rss.data) };
  const g = await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query.replace(/[()]/g, ''))}&mode=artlist&format=json&maxrecords=50&timespan=${WINDOW_DAYS}d`,
    { timeoutMs: 10_000, retries: 0, maxBytes: 2 * 1024 * 1024, signal });
  if (g.ok) return { ok: true, via: 'GDELT', articles: parseGdelt(g.data) };
  return { ok: false, error: 'News feeds unavailable', articles: [] };
}

// ── Finding the company's website ───────────────────────────────────────────
// News, directories, data vendors and search tools: they write ABOUT a company, so their
// pages name it, but their inbox is not the company's.
const NOT_COMPANY_SITE = /(?:^|\.)(?:linkedin|crunchbase|tracxn|wikipedia|twitter|x|facebook|instagram|youtube|google|bloomberg|reuters|techcrunch|inc42|yourstory|economictimes|moneycontrol|livemint|entrackr|vccircle|businessinsider|forbes|medium|github|glassdoor|ambitionbox|zaubacorp|pitchbook|dealroom|apple|play|leadiq|zoominfo|apollo|rocketreach|lusha|signalhire|owler|cbinsights|clearbit|golden|f6s|startupranking|wellfound|angel|ycombinator|producthunt|g2|capterra|trustpilot|indeed|naukri|tavily|serpapi|prnewswire|businesswire|globenewswire|news18|ndtv|thehindu|hindustantimes|financialexpress|businessstandard|bwdisrupt|businessworld|usnews|venturebeat|axios|substack|wordpress|blogspot|reddit|quora)\.[a-z.]+$/i;
const slug = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Pure: does this host look like the company's own? The address itself has to be the
 * name ("nooks.ai" for Nooks, "dispatchnetwork.co" for Dispatch Network), or one of the
 * usual variants (getnooks, nookshq) — not merely contain it ("flightdispatchnetwork").
 */
function hostMatches(host, name) {
  const label = String(host || '').toLowerCase().replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/g, '');
  const s = slug(name);
  if (!label || !s) return false;
  const variants = [s, `get${s}`, `try${s}`, `use${s}`, `join${s}`, `${s}hq`, `${s}app`, `${s}ai`, `${s}labs`, `${s}tech`, `${s}india`, `the${s}`];
  return variants.includes(label);
}

// Words in a headline that say what the company does, not that it raised money.
const HEADLINE_STOP = new Set(`raises raised secures secured bags bagged closes closed lands landed gets announces nets funding round
  seed series pre million billion crore lakh from with led by and the for its in of to a an startup startups company firm
  india indian based platform expansion investors ventures capital partners new`.split(/\s+/).filter(Boolean));
function contextWords(headline, name) {
  const own = new Set(words(name).split(' '));
  return [...new Set(words(headline).split(' ').filter(w => w.length >= 4 && !own.has(w) && !HEADLINE_STOP.has(w) && !/^\d/.test(w)))];
}
const mentionsAny = (text, list) => { const t = ` ${words(text)} `; return list.some(w => t.includes(` ${w} `)); };

/**
 * The company's own website, or null. A candidate must have the company's name as its
 * address, and — unless the name is long enough to be unmistakable — say something the
 * headline says about the company ("sales" for "AI Sales Startup Nooks"). A wrong site
 * is worse than none: its inbox would be offered as theirs.
 */
async function findDomain(name, { userId, keys, signal, headline = '' }) {
  const s = slug(name);
  if (s.length < 3) return null;
  const context = contextWords(headline, name);
  const distinctive = s.length >= 6;
  const homeSays = async (host) => {
    if (!context.length) return false;
    const r = await fetchText(`https://${host}/`, { timeoutMs: 5_000, maxBytes: 512 * 1024, signal });
    return r.ok && mentionsAny(htmlToText(r.data).slice(0, 20_000), context);
  };

  if (keys && (keys.tavily || keys.serpapi)) {
    const r = await webSearch({ userId, keys, query: `"${name}" official website`, signal });
    for (const row of r.results || []) {
      let host = '';
      try { host = new URL(row.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { continue; }
      if (NOT_COMPANY_SITE.test(host) || !hostMatches(host, name)) continue;
      if (distinctive || mentionsAny(`${row.title} ${row.snippet}`, context) || await homeSays(host)) return host;
    }
  }
  // No search key (or nothing found): the obvious domains, accepted only when the
  // homepage names the company and, for a short name, says what the headline says.
  const tries = await mapLimit([`${s}.com`, `${s}.ai`, `${s}.in`, `${s}.io`, `${s}.co`], 5, async (d) => {
    const r = await fetchText(`https://${d}/`, { timeoutMs: 5_000, maxBytes: 512 * 1024, signal });
    if (!r.ok || !titleMatches(pageTitle(r.data), name)) return null;
    return distinctive || mentionsAny(htmlToText(r.data).slice(0, 20_000), context) ? d : null;
  });
  return tries.find(Boolean) || null;
}

const DAY = 24 * 3600 * 1000;

/** One run's work: the searches to make. */
async function plan({ profile } = {}) {
  const queries = buildQueries(profile);
  return { error: queries.length ? null : 'Add the kinds of client you want in My profile', units: queries.map(q => ({ query: q })) };
}

/** One search → items, each with whatever contact its website gave up. */
async function collect(unit, { userId, keys, signal, now = new Date() } = {}) {
  const h = await headlines(unit.query, { signal });
  if (!h.ok) return { error: h.error, items: [], read: 0 };
  const seen = new Set();
  const picks = [];
  for (const a of h.articles) {
    if (!a.title || !(a.at instanceof Date) || Number.isNaN(a.at.getTime()) || now - a.at > WINDOW_DAYS * DAY) continue;
    if (!isFunding(a.title)) continue;
    const name = companyFromHeadline(a.title);
    if (!name || seen.has(slug(name))) continue;
    seen.add(slug(name));
    picks.push({ name, article: a });
    if (picks.length >= PER_UNIT) break;
  }

  const items = await mapLimit(picks, 2, async ({ name, article }) => {
    const domain = await findDomain(name, { userId, keys, signal, headline: article.title }).catch(() => null);
    const site = domain ? await scanWebsite(domain, signal).catch(() => null) : null;
    const emails = site && site.ok
      ? [...site.personal.map(email => ({ email, confidence: 'high' })), ...site.generic.map(email => ({ email, confidence: 'medium' }))]
      : [];
    const days = Math.max(0, Math.floor((now - article.at) / DAY));
    const source = [h.via, article.publisher].filter(Boolean).join(' · ');
    return {
      source: 'news',
      sourceType: 'trigger',
      triggerReason: `raised money ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`,
      text: `${article.title}\n${site && site.title ? site.title : ''}`,
      name,
      domain: domain || null,
      emails,
      url: article.url,
      where: domain ? `${source} · ${domain}` : source,
      postedAt: article.at,
      about: `${article.title}${site && site.title ? ` — ${site.title}` : ''}`,
      signals: [
        { text: `Funding news: “${article.title}”`, source: source || 'News', url: article.url, at: article.at },
        ...(emails.length ? [{ text: `Contact found on their website (${domain})`, source: 'Their website', url: `https://${domain}`, at: null }] : []),
      ],
    };
  });
  return { error: null, items: items.filter(Boolean), read: h.articles.length };
}

module.exports = { plan, collect, buildQueries, companyFromHeadline, isFunding, parseRss, parseGdelt, findDomain, hostMatches };
