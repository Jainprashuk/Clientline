/**
 * What a reply wants. Free rules first (out-of-office, "remove me", a flat no),
 * then the user's AI with the prototype's seven categories. Never throws; with
 * no AI key, or when the AI fails, the category is null and the reply simply
 * waits in Needs you unsorted.
 *
 * The rule-then-AI shape is Outreach's lib/replyClassifier.js + lib/classify/rules.js;
 * the categories are a freelancer's, not a job seeker's.
 */
const { completeChecked, parseJson } = require('../ai/complete');

const CATEGORIES = {
  'wants-quote': 'Wants a quote or price',
  'wants-call': 'Wants a call or meeting',
  samples: 'Asked for work samples or a portfolio',
  interested: 'Interested, wants to know more',
  'not-now': 'Not now — maybe later',
  no: 'Not interested',
  auto: 'Auto-reply (out of office)',
};
// These don't need an answer from you.
const QUIET = new Set(['no', 'auto']);

/** A reply without the quoted email under it. */
function stripQuoted(text) {
  const out = [];
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (t.startsWith('>')) break;
    if (/^on .{4,200}wrote:$/i.test(t)) break;
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(t)) break;
    if (/^from:\s.+$/i.test(t) && out.length > 1) break; // Outlook's quoted header
    out.push(line);
  }
  return out.join('\n').trim();
}

const AUTO_SUBJECT = /^(?:automatic reply|auto(?:matic)?[-\s]?(?:reply|response)|out of (?:the )?office|ooo|away|on leave|vacation)\b/i;
const AUTO_BODY = /\b(?:out of (?:the )?office|on (?:annual |maternity |paternity )?leave|on vacation|on holiday|limited access to (?:my )?email|away from (?:my )?(?:desk|email)|will (?:respond|reply|get back)[^.]{0,40}(?:when|upon|after) (?:i|my) return)\b/i;
const STOP = /\b(?:unsubscribe|remove me|take me off|stop (?:emailing|contacting|sending)|do not (?:contact|email)|don'?t (?:contact|email) (?:me|us)|not to be contacted)\b/i;
const FLAT_NO = /\b(?:not interested|no thanks|no,? thank you|we(?:'re| are) (?:all )?set|not a (?:good )?fit|not looking|we'll pass|we will pass|no need)\b/i;

/** "back on 12 Jan" / "returning January 12" / "until 15/01" → a Date, or null. */
function returnDate(text, now = new Date()) {
  const m = String(text || '').match(/\b(?:back|return(?:ing)?|until|till)\s+(?:on\s+|by\s+)?((?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9})|(?:[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?)|(?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?))/i);
  if (!m) return null;
  let s = m[1].replace(/(\d)(st|nd|rd|th)/i, '$1');
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (dmy) s = `${dmy[3] ? (dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : now.getFullYear()}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  else if (!/\d{4}/.test(s)) s = `${s} ${now.getFullYear()}`;
  let d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (d < now) d = new Date(d.setFullYear(d.getFullYear() + 1)); // "back 3 Jan" said in December
  return d - now > 120 * 86400000 ? null : d;
}

/**
 * Pure: the free rules. { category, why, stop? , backOn? } or null when the AI should decide.
 * `headers` is mailparser's header Map (or a plain object) — Auto-Submitted is the
 * reliable auto-reply signal.
 */
function byRules({ subject = '', text = '', headers = null }, now = new Date()) {
  const h = (k) => (headers && (headers.get ? headers.get(k) : headers[k])) || '';
  const autoHeader = /^auto-(?:replied|generated)/i.test(String(h('auto-submitted'))) || !!h('x-autoreply') || !!h('x-autorespond') || /auto_reply/i.test(String(h('precedence')));
  const body = stripQuoted(text);
  if (autoHeader || AUTO_SUBJECT.test(subject.trim()) || (AUTO_BODY.test(body) && body.length < 1200)) {
    return { category: 'auto', why: 'An automatic out-of-office reply', backOn: returnDate(body, now) };
  }
  if (STOP.test(body)) return { category: 'no', why: 'They asked not to be emailed', stop: true };
  if (body.length < 220 && FLAT_NO.test(body)) return { category: 'no', why: 'A short no' };
  return null;
}

const SYSTEM = `You sort replies a freelancer got to a cold email. Pick the ONE category that fits the reply best:
${Object.entries(CATEGORIES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Return JSON only: {"category": "<one key from the list>", "why": "<under 15 words, plain>"}`;

/** { category, why, by: 'rule'|'ai'|null, stop?, backOn?, noKeys? } — never throws. */
async function classifyReply(userId, { subject, text, headers }) {
  const rule = byRules({ subject, text, headers });
  if (rule) return { ...rule, by: 'rule' };
  const body = stripQuoted(text).slice(0, 2000);
  try {
    const r = await completeChecked(userId,
      { system: SYSTEM, prompt: `Subject: ${subject || '(none)'}\n\n${body || '(empty)'}`, maxTokens: 80, temperature: 0, json: true },
      { feature: 'replysort', check: (t) => { const d = parseJson(t); return d && CATEGORIES[d.category] ? null : 'category must be one of the listed keys'; } });
    if (!r.ok) return { category: null, why: '', by: null, noKeys: !!r.noKeys };
    const d = parseJson(r.text);
    return { category: d.category, why: String(d.why || '').slice(0, 160), by: 'ai' };
  } catch (_) {
    return { category: null, why: '', by: null };
  }
}

const needsYouFor = (category) => !QUIET.has(category);

module.exports = { classifyReply, byRules, stripQuoted, returnDate, needsYouFor, CATEGORIES, QUIET };
