/**
 * The checks every AI-written line to a lead must pass, whatever its length: no
 * number, link, address, quote or name that wasn't in what the model was shown.
 * Shared by the first line (lib/leads/opener.js) and the first email
 * (lib/outreach/firstEmail.js). Pure.
 */

// Capitalised words that are not names.
const COMMON_CAPS = new Set(['i', "i'm", 'i’m', "i've", 'i’ve', "i'd", 'i’d', "i'll", 'i’ll', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'india', 'indian', 'ai', 'api', 'mvp', 'saas', 'seo', 'ui', 'ux', 'cr', 'inr', 'usd', 'congrats', 'congratulations', 'happy', 'want', 'worth']);

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const NAME_STOP = new Set(['the', 'and', 'for', 'pvt', 'ltd', 'llc', 'inc', 'limited', 'private', 'technologies', 'technology',
  'solutions', 'software', 'services', 'labs', 'systems', 'india', 'global', 'group', 'company', 'user', 'post', 'linkedin', 'reddit', 'web']);
const namesIn = (text) => squash(text).split(' ').filter(w => w.length >= 3 && !NAME_STOP.has(w));

const LINK = /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+/gi;

/**
 * Null when `text` claims nothing beyond `shown` (one string of everything the
 * model was given), else the reason.
 */
function claimsOutside(text, shown) {
  const seen = squash(shown);
  // Every number must be in what it was shown ("₹6 Cr", "34 to 92", "2 months").
  // The whole token a number sits in ("18", "$3M" → "3m", "D2C" → "d2c", "1,200"), so
  // "8 years" doesn't pass because "18%" was shown.
  for (const n of text.match(/[a-z0-9]*\d+(?:[.,]\d+)?[a-z0-9]*/gi) || []) {
    if (!` ${seen} `.includes(` ${squash(n)} `)) return `uses a number that is not in the facts (${n})`;
  }
  for (const x of text.match(LINK) || []) {
    if (!seen.includes(squash(x))) return 'uses a link or address that is not in the facts';
  }
  // Quotes are claims about what someone said: they must be in the facts verbatim.
  for (const q of text.match(/"([^"]{8,})"|“([^”]{8,})”/g) || []) {
    if (!seen.includes(squash(q))) return 'quotes something that is not in the facts';
  }
  // Names are claims too ("I did this for Swiggy"): every capitalised word that
  // doesn't start a sentence must be one it was shown.
  for (const m of text.matchAll(/[A-Z][\w'’.&-]{2,}/g)) {
    const before = text.slice(0, m.index);
    if (!before.trim() || /[.!?:—–\-\n]\s*$/.test(before) || COMMON_CAPS.has(m[0].toLowerCase().replace(/[.,]$/, ''))) continue;
    const word = squash(m[0].replace(/['’]s$/, ''));
    if (word && !seen.includes(word)) return `names something that is not in the facts (${m[0]})`;
  }
  return null;
}

/** True when `text` mentions this lead: its name, or a distinctive word from its facts. */
function speaksTo(text, lead, facts) {
  const mine = squash(text);
  const hooks = [...namesIn(lead.name), ...facts.flatMap(f => namesIn(f.text)).filter(w => w.length >= 5)];
  return !hooks.length || hooks.some(w => mine.includes(w));
}

/** The longest run of words `text` copies from `source`. */
function longestCopy(text, source) {
  const a = squash(text).split(' '); const src = ` ${squash(source)} `;
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    let n = best + 1;
    while (i + n <= a.length && src.includes(` ${a.slice(i, i + n).join(' ')} `)) { best = n; n++; }
  }
  return best;
}

module.exports = { claimsOutside, speaksTo, longestCopy, squash, namesIn, COMMON_CAPS, LINK };
