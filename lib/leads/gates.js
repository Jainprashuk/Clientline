/**
 * The quality gates: does this item become a lead at all?
 *
 * Rules, not AI. An AI reading of a post (lib/leads/readPosts.js) is optional
 * input and only ever settles intent; it never decides fit, budget or place,
 * and when it is missing the text rules here decide alone.
 *
 * Pure and synchronous so every rule can be tested without a network. The
 * shape follows Outreach's lib/sources/sourceFit.js: REJECT = -999, a verdict
 * with readable reasons, silence about a place never read as "elsewhere".
 *
 * judge(item, profile, now) → {
 *   verdict: 'keep' | 'held' | 'drop',
 *   reason,            // why it was dropped or held, '' for keep
 *   service,           // the profile service it matched (or null)
 *   place,             // 'wanted' | 'global' | 'remote' | 'elsewhere' | 'unknown'
 *   budget,            // { amount, currency, hourly } parsed from the text, or null
 * }
 *
 * item: { source, sourceType: 'asked'|'trigger', text, emails[{email, confidence}],
 *         postedAt, signals[], location, remote, ai? {writer, needsFreelancer, selfPromo} }
 */

const REJECT = -999;

const rx = (parts, flags = 'i') => new RegExp(parts.join('|'), flags);
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Gate 1: a real client, not another freelancer ──────────────────────────
// Freelancers and agencies advertising themselves, people looking for work.
const SELF_PROMO = rx([
  String.raw`\bseeking\s+work\b`,
  String.raw`\b(?:i\s?a?m|i'm|im|we\s?are|we're)\s+(?:currently\s+)?(?:available|open)\s+(?:for|to)\s+(?:new\s+)?(?:freelance|projects?|work|clients|hire|gigs)`,
  String.raw`\bavailable\s+for\s+(?:hire|freelance|new\s+projects|contract\s+work)\b`,
  String.raw`\bhire\s+me\b`, String.raw`#open_?to_?work`,
  String.raw`\b(?:i\s?a?m|i'm)\s+(?:a|an)\s+(?:freelance|independent)\b`,
  String.raw`\b(?:looking|searching)\s+for\s+(?:new\s+)?(?:freelance\s+)?(?:work|projects|clients|gigs|opportunities)\b`,
  String.raw`\b(?:dm|contact|message)\s+(?:me|us)\s+(?:for|to\s+get)\s+(?:your|a)\s+(?:website|app|logo|design)\b`,
  String.raw`\bwe\s+(?:offer|provide|build|design)\s+(?:affordable|professional|custom|high[\s-]quality)\b`,
  String.raw`\bour\s+(?:services|portfolio|agency)\b`,
  // First person describing themselves as the one who does the work.
  String.raw`\b(?:i'?m|i\s+am)\s+an?\s+(?:[\w-]+\s+){0,3}(?:developer|designer|engineer|freelancer|consultant|dev)\b`,
  String.raw`\b(?:recently\s+)?laid\s+off\b`,
  String.raw`\b(?:is|are)\s+an?\s+(?:[\w-]+\s+){0,4}(?:development\s+partner|agency|dev\s+shop|software\s+(?:company|house)|it\s+company)\b[^.]{0,60}\boffering\b`,
  String.raw`\blooking\s+for\s+(?:some\s+)?(?:quick\s+|new\s+|freelance\s+)?(?:work|gigs|projects|opportunities|clients)\b`,
]);

// A seller talking to the reader as the client ("We can work on a new website or
// improve an existing one, depending on your needs"). Unambiguous enough to overrule
// an AI reading that took the list of services for a request.
const SELLER_PITCH = rx([
  String.raw`\bwe\s+can\s+(?:work\s+on|build|design|create|develop|take\s+care\s+of|help\s+you)\b[^.]{0,80}\b(?:your|you)\b`,
  String.raw`\bdepending\s+on\s+your\s+(?:needs|requirements|budget|goals|business)\b`,
  String.raw`\bwe\s+speciali[sz]e\s+in\b`,
  String.raw`\bour\s+(?:services|expertise|offerings?)\s+(?:include|cover|range)\b`,
  String.raw`\b(?:dm|message|contact|reach\s+out\s+to)\s+(?:me|us)\s+(?:for|to\s+(?:discuss|build|get))\s+your\b`,
  String.raw`\b(?:let'?s|let\s+us)\s+(?:build|create|design|discuss)\s+your\b`,
]);

// Someone who needs work done.
// Up to three words between the ask and who: "looking for a freelance React developer".
const WHO = String.raw`(?:freelancers?|contractors?|developers?|devs?|designers?|agenc(?:y|ies)|consultants?|experts?|someone|engineers?|writers?|editors?|marketers?|help|freelance\s+help)`;
const GAP = String.raw`(?:an?\s+|some\s+)?(?:[\w.+#/-]+\s+){0,3}?`;
const NEEDS = rx([
  String.raw`\b(?:looking|searching)\s+for\s+${GAP}${WHO}\b`,
  String.raw`\b(?:need|needs|needed|require|requires|want|wants)\s+${GAP}${WHO}\b`,
  String.raw`\bseeking\s+${GAP}(?:freelancers?|contractors?|developers?|designers?|agency|consultants?)\b`,
  String.raw`\bhiring\s+(?:an?\s+)?(?:freelance|contract|part[\s-]time)\b`,
  String.raw`\bseeking\s+freelancer\b`,
  String.raw`\bneed\s+help\s+(?:with|building|designing|setting\s+up|fixing)\b`,
  String.raw`\b(?:who|anyone)\s+can\s+(?:build|design|make|fix|help|develop)\b`,
  String.raw`\b(?:can\s+)?(?:anyone|someone)\s+(?:recommend|suggest|refer)\s+(?:an?\s+)?(?:good\s+)?(?:freelancer|developer|designer|agency)\b`,
  String.raw`\b(?:does\s+)?(?:anyone|someone|anybody)\s+know\s+(?:a|an|any|of\s+a)\s+${GAP}${WHO}\b`,
  String.raw`\b(?:freelance|contract)\s+(?:role|position|gig|project|opportunity)\b`,
  String.raw`\b(?:recommendations?|referrals?)\s+for\s+${GAP}${WHO}\b`,
  String.raw`\b${WHO}\s+or\s+(?:a\s+)?small\s+agency\b`,
]);

// What the AI reading says the writer is, when it isn't a client or a seller.
const NOT_A_POST = {
  job: 'A job board or job ad, not a client',
  article: 'An article or landing page, not a client',
  discussion: 'No sign they need someone',
};

// Employment, not freelance work. Dropped unless the post also says contract/freelance.
const EMPLOYMENT = rx([
  String.raw`\bfull[\s-]?time\s+(?:role|position|job|employee|opening)\b`, String.raw`\bpermanent\s+(?:role|position)\b`,
  String.raw`\b(?:ctc|lpa)\b`, String.raw`\bsalary\s+(?:range|of|up\s+to)\b`, String.raw`\bjoin\s+our\s+team\s+as\s+(?:a|an)\b`,
  String.raw`\b(?:benefits|401k|health\s+insurance|esops?|stock\s+options)\b`,
]);
const CONTRACT = /\b(?:freelance|freelancer|contract(?:or)?|part[\s-]?time|project[\s-]based|one[\s-]?off|fixed[\s-]price|per\s+project|gig)\b/i;

// ── Gate 7: red flags ───────────────────────────────────────────────────────
const RED_FLAGS = [
  [/\b(?:unpaid|free)\s+(?:test|trial|task|sample|assignment)\b|\btest\s+task\b[^.\n]{0,40}\bunpaid\b/i, 'asks for unpaid test work'],
  [/\bpay(?:ment)?\s+(?:after|once|when)\s+(?:we\s+)?(?:launch|go\s+live|get\s+funding|are\s+funded|make\s+(?:money|revenue))/i, 'pays only after launch or funding'],
  [/\b(?:equity[\s-]only|only\s+equity|for\s+equity\s+only|no\s+budget|zero\s+budget|unpaid\s+(?:role|project|position))\b/i, 'no paid budget'],
  [/\b(?:for\s+(?:the\s+)?exposure|portfolio\s+piece|great\s+for\s+your\s+portfolio)\b/i, 'offers exposure instead of pay'],
];
// A negation within a few words before an excluded word ("never ask for unpaid").
const NEGATED = /\b(?:no|not|never|without|nor|zero|non|isn'?t|aren'?t|don'?t|doesn'?t|won'?t)\b(?:\s+[a-z'-]+){0,3}\s*$/i;
const URGENT =/\b(?:urgent(?:ly)?|asap|immediately|today\s+itself|by\s+tomorrow)\b/i;

// ── Gate 3: place ───────────────────────────────────────────────────────────
// Regions a profile can name, and how a post names them. Anything else in the
// profile ("indore", "berlin") is matched as a whole word.
const REGIONS = {
  india: /\bindia\b|\bpan[\s-]?india\b|\+91[\s-]?\d|\binr\b|₹|\blakhs?\b|\b(?:bengaluru|bangalore|hyderabad|pune|mumbai|chennai|kolkata|ahmedabad|jaipur|indore|noida|gurgaon|gurugram|delhi|ncr|chandigarh|kochi|coimbatore|lucknow|nagpur|surat|bhopal)\b/i,
  us: /\bu\.?s\.?a?\b|\bunited\s+states\b|\bamerica\b|\b(?:new\s+york|nyc|san\s+francisco|sf\s+bay|los\s+angeles|seattle|boston|austin|chicago|texas|california)\b|\b(?:est|pst|cst)\b/i,
  uk: /\bu\.?k\.?\b|\bunited\s+kingdom\b|\b(?:england|london|manchester|edinburgh|scotland)\b|\bgbp\b|£/i,
  europe: /\beurope\b|\beu\b|\b(?:germany|berlin|munich|france|paris|netherlands|amsterdam|spain|madrid|ireland|dublin|sweden|stockholm|switzerland|zurich|italy|poland|portugal|lisbon)\b|€|\bcet\b/i,
  canada: /\bcanada\b|\b(?:toronto|vancouver|montreal)\b/i,
  australia: /\baustralia\b|\b(?:sydney|melbourne|brisbane)\b|\baest\b/i,
  uae: /\buae\b|\bdubai\b|\babu\s+dhabi\b/i,
  singapore: /\bsingapore\b/i,
};
// "Remote, US only" is not remote for everyone.
const REMOTE_LIMITED = /\bremote\s*[(,-]?\s*(?:us|usa|u\.s\.|eu|europe|uk|canada|north\s+america|americas)\s*(?:only|based|citizens?|residents?)?\b|\b(?:us|uk|eu|canada)[\s-](?:only|based\s+only)\b/i;
const GLOBAL_REMOTE = /\bremote\b[^.\n|]{0,40}?\b(?:worldwide|global(?:ly)?|anywhere|international)\b|\b(?:worldwide|global|anywhere)\b[^.\n|]{0,15}\bremote\b|\b(?:anywhere\s+in\s+the\s+world|work\s+from\s+anywhere)\b/i;
const REMOTE = /\bremote(?:ly)?\b|\bwork\s+from\s+home\b|\bwfh\b/i;

/** 'wanted' | 'global' | 'remote' | 'elsewhere' | 'unknown'. Silence is not a foreign country. */
function placeOf(text, { locations = [], remote = null } = {}) {
  const t = String(text || '');
  // "remote" is how they work, not where they are: profile.remoteOk covers it.
  const wanted = locations.map(norm).filter(l => l && !/^(?:remote|anywhere|worldwide|global)$/.test(l));
  const named = (l) => (REGIONS[l] ? REGIONS[l].test(t) : new RegExp(`\\b${escape(l)}\\b`, 'i').test(t));
  if (wanted.some(named)) return 'wanted';
  if (GLOBAL_REMOTE.test(t)) return 'global';
  if (REMOTE_LIMITED.test(t)) return 'elsewhere';
  const elsewhere = Object.keys(REGIONS).some(r => !wanted.includes(r) && REGIONS[r].test(t));
  if (remote === true || REMOTE.test(t)) return elsewhere ? 'elsewhere-remote' : 'remote';
  return elsewhere ? 'elsewhere' : 'unknown';
}

// ── Gate 3: budget ──────────────────────────────────────────────────────────
// Rough rates for comparing a stated budget with the profile's minimum. Only
// ever used to reject a budget that is clearly too small, so precision does not
// matter; a quarterly refresh is plenty.
const TO_INR = { INR: 1, USD: 84, EUR: 91, GBP: 107, AUD: 55, CAD: 61, AED: 23, SGD: 63 };
const SYMBOL = { '$': 'USD', '₹': 'INR', '€': 'EUR', '£': 'GBP' };
const CODE = /\b(inr|rs\.?|rupees?|usd|dollars?|eur|euros?|gbp|pounds?|aud|cad|aed|sgd)\b/i;
const codeOf = (s) => {
  const c = String(s || '').toLowerCase().replace(/\.$/, '');
  if (/^(inr|rs|rupees?)$/.test(c)) return 'INR';
  if (/^(usd|dollars?)$/.test(c)) return 'USD';
  if (/^(eur|euros?)$/.test(c)) return 'EUR';
  if (/^(gbp|pounds?)$/.test(c)) return 'GBP';
  return c.toUpperCase();
};
const scale = (n, unit) => {
  const u = String(unit || '').toLowerCase();
  if (u === 'k') return n * 1e3;
  if (u === 'm' || u === 'mn') return n * 1e6;
  if (/^(l|lac|lakh|lakhs)$/.test(u)) return n * 1e5;
  if (/^(cr|crore|crores)$/.test(u)) return n * 1e7;
  return n;
};
// "$5k", "$2,000-$5,000", "₹50,000", "Rs. 1.5 lakh", "3000 USD", "€800/month", "$40/hr".
const MONEY = /([$₹€£])\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|mn|l|lac|lakhs?|cr|crores?)?\b(\s*(?:\/|per)\s*(?:hr|hour|h)\b)?|\b(\d[\d,]*(?:\.\d+)?)\s?(k|m|l|lac|lakhs?|cr|crores?)?\s*(inr|rs\.?|rupees?|usd|dollars?|eur|euros?|gbp|pounds?|aud|cad|aed|sgd)\b(\s*(?:\/|per)\s*(?:hr|hour|h)\b)?|\b(?:rs\.?|inr)\s?(\d[\d,]*(?:\.\d+)?)\s?(k|l|lac|lakhs?|cr|crores?)?\b(\s*(?:\/|per)\s*(?:hr|hour|h)\b)?/gi;

const HOURLY_CONTEXT = /\/\s*(?:hr|hour|h)\b|\bper\s+hour\b|\bhourly\b|\/hr\b/i;

/** The largest amount the post offers, as { amount, currency, hourly, inr }, or null. */
function parseBudget(text) {
  const t = String(text || '');
  let best = null;
  for (const m of t.matchAll(MONEY)) {
    let amount; let currency; let hourly;
    if (m[1]) { amount = scale(Number(m[2].replace(/,/g, '')), m[3]); currency = SYMBOL[m[1]]; hourly = !!m[4]; }
    else if (m[5]) { amount = scale(Number(m[5].replace(/,/g, '')), m[6]); currency = codeOf(m[7]); hourly = !!m[8]; }
    else { amount = scale(Number(m[9].replace(/,/g, '')), m[10]); currency = 'INR'; hourly = !!m[11]; }
    if (!Number.isFinite(amount) || amount <= 0 || !TO_INR[currency]) continue;
    // Years, counts and phone numbers are not budgets.
    if (!hourly && amount < 50 && currency !== 'INR') continue;
    // "$55 - $75/hr": the /hr sits on the last number only. In a post that talks
    // hourly, a small amount is a rate, not a project budget.
    if (!hourly && HOURLY_CONTEXT.test(t) && amount * TO_INR[currency] < 25_000) hourly = true;
    const inr = amount * TO_INR[currency];
    if (!best || (hourly === best.hourly ? inr > best.inr : !hourly)) best = { amount, currency, hourly, inr };
  }
  return best;
}
const toCurrency = (inr, currency) => inr / (TO_INR[currency] || 1);

// ── Gate 3: services ────────────────────────────────────────────────────────
// Forgiving of how people write it: "React.js" ~ "react", "Full-Stack" ~ "full stack".
const loose = (s) => norm(s).replace(/\.js\b/g, '').replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ');

/** The services this text matches, each with the keywords it hit; best first. */
function serviceHits(text, services = []) {
  const hay = ` ${loose(text)} `;
  const out = [];
  for (const s of services) {
    const hits = (s.keywords || []).filter(k => {
      const kw = loose(k);
      return kw && new RegExp(`(^|[^a-z0-9])${escape(kw)}($|[^a-z0-9])`, 'i').test(hay);
    });
    if (hits.length) out.push({ service: s, hits });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length);
}

// ── Gate 2: freshness ───────────────────────────────────────────────────────
const DAY = 24 * 3600 * 1000;
const MAX_AGE_DAYS = { 'web-post': 7, hn: 45, news: 90, paste: 60 };

function judge(item, profile = {}, now = new Date()) {
  const text = String(item.text || '');
  const asked = item.sourceType !== 'trigger';
  const result = (verdict, reason, extra = {}) => ({ verdict, reason, service: null, place: 'unknown', budget: null, ...extra });

  // Gate 1. The AI reading settles intent when it has one; the rules decide otherwise.
  if (asked) {
    if (item.ai && NOT_A_POST[item.ai.writer]) return result('drop', NOT_A_POST[item.ai.writer]);
    const selfPromo = item.ai && typeof item.ai.selfPromo === 'boolean' ? item.ai.selfPromo : SELF_PROMO.test(text);
    if (SELLER_PITCH.test(text) || (selfPromo && !(item.ai && item.ai.needsFreelancer === true))) return result('drop', 'A freelancer or agency advertising, not a client');
    const needs = item.ai && typeof item.ai.needsFreelancer === 'boolean' ? item.ai.needsFreelancer : NEEDS.test(text);
    if (!needs && !item.needsByConstruction) return result('drop', 'No sign they need someone');
    // An AI reading that says they want outside help settles it; otherwise the rules do.
    const aiSaysClient = !!(item.ai && item.ai.needsFreelancer === true);
    if (!aiSaysClient && EMPLOYMENT.test(text) && !CONTRACT.test(text)) return result('drop', 'A full-time job, not freelance work');
    // A web snippet that never says freelance/contract is almost always a job opening
    // ("We are looking for a skilled ReactJS Developer to join…").
    if (!aiSaysClient && item.source === 'web-post' && !CONTRACT.test(text)) return result('drop', 'Reads like a job opening, not freelance work');
  }

  // Gate 2.
  const posted = item.postedAt ? new Date(item.postedAt) : null;
  const maxAge = MAX_AGE_DAYS[item.source];
  if (posted && !Number.isNaN(posted.getTime()) && maxAge && now - posted > maxAge * DAY) {
    return result('drop', `Older than ${maxAge} days`);
  }

  // Gate 7 (before fit: a red flag is a red flag whatever the service).
  for (const [re, why] of RED_FLAGS) if (re.test(text)) return result('drop', `Red flag: ${why}`);

  // Gate 3: exclusions, service, budget, place.
  const lowered = ` ${loose(text)} `;
  // "We never ask for unpaid work" or "no WordPress" is the post agreeing with you,
  // so a mention right after a negation doesn't count.
  const excluded = (profile.exclusions || []).find(x => {
    const w = loose(x);
    if (!w) return false;
    const re = new RegExp(`(^|[^a-z0-9])${escape(w)}($|[^a-z0-9])`, 'gi');
    for (const m of lowered.matchAll(re)) {
      if (!NEGATED.test(lowered.slice(Math.max(0, m.index - 40), m.index + 1))) return true;
    }
    return false;
  });
  if (excluded) return result('drop', `Mentions "${excluded}", which you leave out`);

  const hits = serviceHits(text, profile.services || []);
  const best = hits[0] || null;
  // A funding headline rarely names the work; triggers are judged on the client, not keywords.
  if (asked && !best) return result('drop', 'Not one of your services');

  // A funding round is money they raised, not money offered for a job: budgets only come from asks.
  const budget = asked ? parseBudget(text) : null;
  if (budget && !budget.hourly) {
    const floor = (best && best.service.minBudget) || profile.minProject || 0;
    const cur = profile.currency || 'INR';
    if (floor && toCurrency(budget.inr, cur) < floor) {
      return result('drop', `Budget ${budget.currency} ${Math.round(budget.amount).toLocaleString('en-IN')} is below your ${cur} ${floor.toLocaleString('en-IN')} minimum`, { budget });
    }
    if (floor && URGENT.test(text) && toCurrency(budget.inr, cur) < floor * 1.5) {
      return result('drop', 'Red flag: urgent with a small budget', { budget });
    }
  }
  if (budget && budget.hourly && profile.rate && toCurrency(budget.inr, profile.currency || 'INR') < profile.rate * 0.6) {
    return result('drop', 'Hourly rate well below yours', { budget });
  }

  const place = placeOf(`${item.location || ''} ${text}`, { locations: profile.locations || [], remote: item.remote });
  if (place === 'elsewhere') return result('drop', 'Outside where you work', { budget, place });
  if (place === 'elsewhere-remote' && !profile.remoteOk) return result('drop', 'Remote, but from a region you don’t work with', { budget, place });

  // Gate 4: a provable reason to write now.
  const signals = item.signals || [];
  if (!signals.length) return result('drop', 'No reason to write now', { budget, place });

  // Gate 5: reachable. Held, not dropped: a contact may still be found.
  const emails = item.emails || [];
  const extra = { service: best ? best.service : null, serviceHits: best ? best.hits : [], budget, place };
  if (!emails.length) return { verdict: 'held', reason: 'No email found yet', ...extra };

  return { verdict: 'keep', reason: '', ...extra };
}

module.exports = { judge, placeOf, parseBudget, serviceHits, REJECT, SELF_PROMO, SELLER_PITCH, NEEDS, EMPLOYMENT, RED_FLAGS, REGIONS, MAX_AGE_DAYS, TO_INR, loose };
