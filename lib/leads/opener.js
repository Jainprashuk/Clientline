/**
 * A lead's first line: one or two sentences that open a cold email, written by
 * the user's own AI chain from ONLY the lead's facts and the user's profile.
 *
 * The model sees the facts labelled (F1, F2…) and the user's results (R1, R2…)
 * and must say which it used. checkOpener() then rejects anything it could
 * have invented: a number, link, email or quote that is not in what it was
 * shown, boilerplate, a greeting, or a line that never mentions this lead. A
 * rejected line is retried once with the reason, then the next provider is
 * tried (lib/ai/complete.js); if every provider fails, no line is stored.
 *
 * The validator follows Outreach's checkNote (lib/applyNote.js).
 */
const Lead = require('../../models/Lead');
const Profile = require('../../models/Profile');
const { completeChecked, parseJson } = require('../ai/complete');

const MIN = 90;
const MAX = 320;

const BANNED = /\b(passionate|dynamic|seasoned|top[\s-]notch|highly skilled|expert in|rock ?star|ninja|synerg\w*|leverage|cutting[\s-]edge|world[\s-]class|game[\s-]chang\w*|i hope this (?:message|email) finds you|i am writing to|i came across your|i noticed that you|reaching out|touch base|perfect fit|look(?:ing)? forward)\b|\[[^\]]{1,40}\]|\{\{|<\/?[a-z][^>]*>|lorem ipsum/i;
const GREETING = /^\s*(?:hi|hello|hey|dear|greetings|good (?:morning|afternoon|evening))\b/i;

// Capitalised words that are not names.
const COMMON_CAPS = new Set(['i', "i'm", 'i’m', "i've", 'i’ve', "i'd", 'i’d', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'india', 'indian', 'ai', 'api', 'mvp', 'saas', 'seo', 'ui', 'ux', 'cr', 'inr', 'usd']);
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const NAME_STOP = new Set(['the', 'and', 'for', 'pvt', 'ltd', 'llc', 'inc', 'limited', 'private', 'technologies', 'technology',
  'solutions', 'software', 'services', 'labs', 'systems', 'india', 'global', 'group', 'company', 'user', 'post', 'linkedin', 'reddit', 'web']);
const namesIn = (text) => squash(text).split(' ').filter(w => w.length >= 3 && !NAME_STOP.has(w));

/** The facts the model may use, labelled. Pure. */
function factsFor(lead) {
  const facts = [];
  for (const s of lead.signals || []) facts.push({ id: `F${facts.length + 1}`, text: String(s.text || '').replace(/[“”]/g, '"'), label: s.source });
  if (lead.about && !(lead.signals || []).some(s => squash(lead.about).startsWith(squash(s.text).slice(0, 60)))) {
    facts.push({ id: `F${facts.length + 1}`, text: String(lead.about).slice(0, 700), label: 'What they wrote' });
  }
  if (lead.budget && lead.budget.amount) {
    facts.push({ id: `F${facts.length + 1}`, text: `Budget mentioned: ${lead.budget.currency} ${Math.round(lead.budget.amount)}${lead.budget.hourly ? ' per hour' : ''}`, label: 'Their post' });
  }
  return facts;
}

/** The user's results and quotes the line may cite, labelled. Pure. */
function resultsFor(profile) {
  const out = [];
  for (const c of profile.cases || []) out.push({ id: `R${out.length + 1}`, text: `${c.title}: ${c.result}`, label: c.title });
  for (const q of profile.proof || []) out.push({ id: `R${out.length + 1}`, text: `"${q.text}" (${q.who})`, label: `Quote from ${q.who || 'a client'}` });
  return out;
}

const SYSTEM = `You write the first line of a cold email from a freelancer to a possible client.
Rules:
- Use ONLY the facts given under LEAD and ME. Never add a number, name, link, company, result or claim that is not written there.
- 1 or 2 sentences, ${MIN}-${MAX} characters. Plain, specific, human. No greeting, no sign-off, no question asking for a call.
- It is the opening of an email TO them: address them as "you" ("You posted…", "Congrats on your seed round…"), never "they" or their company name in the third person.
- Open with the specific thing about them (what they asked for, or what just happened to them), then connect it to what I do.
- You may mention at most one of my results (R…), using its numbers exactly as written. If none fits, mention none.
- Do not flatter. Do not use: passionate, leverage, cutting-edge, "I came across", "I hope this finds you", "reaching out".
Return JSON only: {"line": "...", "used": ["F1", "R2"]}  — "used" lists every fact id the line relies on.`;

function buildPrompt(lead, profile, facts, results) {
  const services = (profile.services || []).map(s => s.name).filter(Boolean).join(', ');
  return [
    'LEAD',
    `Name: ${lead.name}${lead.person ? ` (writing to ${lead.person}${lead.title ? `, ${lead.title}` : ''})` : ''}`,
    ...facts.map(f => `${f.id}: ${f.text}`),
    '',
    'ME',
    profile.name ? `Name: ${profile.name}` : '',
    profile.headline ? `About me: ${profile.headline}` : '',
    services ? `What I sell: ${services}` : '',
    lead.service ? `The service this lead matches: ${lead.service}` : '',
    ...results.map(r => `${r.id}: ${r.text}`),
  ].filter(s => s !== '').join('\n');
}

/**
 * Pure: null when the line is acceptable, else the reason.
 * @param {string} raw     the model's answer (JSON)
 * @param {object} ctx     { lead, facts, results, profile }
 */
function checkOpener(raw, { lead, facts, results, profile = {} }) {
  const data = parseJson(raw);
  if (!data || typeof data.line !== 'string') return 'not the JSON asked for';
  const line = data.line.replace(/\s+/g, ' ').trim();
  if (line.length < MIN) return `too short (${line.length} characters, need ${MIN}+)`;
  if (line.length > MAX) return `too long (${line.length} characters, max ${MAX})`;
  if (GREETING.test(line)) return 'starts with a greeting';
  if (BANNED.test(line)) return 'uses boilerplate or a placeholder';
  const shown = [
    lead.name, lead.person, lead.title, lead.service,
    ...facts.map(f => f.text), ...results.map(r => r.text),
    profile.name, profile.headline, ...(profile.services || []).map(s => s.name),
  ].join(' ');
  const seen = squash(shown);
  // Every number must be in what it was shown ("₹6 Cr", "34 to 92", "2 months").
  for (const n of line.match(/\d+(?:[.,]\d+)?/g) || []) {
    const bare = n.replace(/,/g, '');
    if (!seen.includes(squash(n)) && !seen.split(' ').includes(bare)) return `uses a number that is not in the facts (${n})`;
  }
  for (const x of line.match(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+/gi) || []) {
    if (!seen.includes(squash(x))) return 'uses a link or address that is not in the facts';
  }
  // Quotes are claims about what someone said: they must be in the facts verbatim.
  for (const q of line.match(/"([^"]{8,})"|“([^”]{8,})”/g) || []) {
    if (!seen.includes(squash(q))) return 'quotes something that is not in the facts';
  }
  // Names are claims too ("I did this for Swiggy"): every capitalised word that
  // doesn't start a sentence must be one it was shown.
  for (const m of line.matchAll(/[A-Z][\w'’.&-]{2,}/g)) {
    const before = line.slice(0, m.index);
    if (!before.trim() || /[.!?:—–-]\s*$/.test(before) || COMMON_CAPS.has(m[0].toLowerCase())) continue;
    const word = squash(m[0].replace(/['’]s$/, ''));
    if (word && !seen.includes(word)) return `names something that is not in the facts (${m[0]})`;
  }
  // It must speak to THIS lead: its name, or a distinctive word from its facts.
  const mine = squash(line);
  const hooks = [...namesIn(lead.name), ...facts.flatMap(f => namesIn(f.text)).filter(w => w.length >= 5)];
  if (hooks.length && !hooks.some(w => mine.includes(w))) return 'does not mention anything specific to this lead';
  const ids = new Set([...facts, ...results].map(x => x.id));
  const used = Array.isArray(data.used) ? data.used.filter(u => ids.has(u)) : [];
  if (!used.some(u => u.startsWith('F'))) return 'does not say which lead fact it used';
  return null;
}

/**
 * Writes (or rewrites) one lead's first line and stores it.
 * @returns {Promise<{ok: boolean, lead: object|null, error: string|null, noKeys?: boolean}>}
 */
async function writeOpener(userId, leadId, { profile = null, signal } = {}) {
  const lead = await Lead.findOne({ _id: leadId, userId }).lean();
  if (!lead) return { ok: false, lead: null, error: 'No such lead' };
  const p = profile || (await Profile.findOne({ userId }).lean()) || {};
  const facts = factsFor(lead);
  const results = resultsFor(p);
  if (!facts.length) return { ok: false, lead, error: 'Nothing on this lead to write from' };

  const ctx = { lead, facts, results, profile: p };
  const r = await completeChecked(userId,
    { system: SYSTEM, prompt: buildPrompt(lead, p, facts, results), maxTokens: 250, temperature: 0.5, json: true },
    { feature: 'opener', check: (text) => checkOpener(text, ctx), signal, context: { leadId: String(lead._id), company: lead.name } });

  if (!r.ok) {
    if (r.noKeys) return { ok: false, lead, error: r.error, noKeys: true };
    const updated = await Lead.findOneAndUpdate({ _id: lead._id, userId },
      { $set: { openerState: 'failed', openerError: String(r.error || '').slice(0, 300) } }, { returnDocument: 'after' }).lean();
    return { ok: false, lead: updated, error: r.error };
  }
  const data = parseJson(r.text);
  const byId = Object.fromEntries([...facts, ...results].map(x => [x.id, x.label]));
  const sources = [...new Set((data.used || []).map(u => byId[u]).filter(Boolean))];
  const updated = await Lead.findOneAndUpdate({ _id: lead._id, userId }, {
    $set: { opener: data.line.replace(/\s+/g, ' ').trim(), openerSources: sources, openerState: 'written', openerError: null },
  }, { returnDocument: 'after' }).lean();
  return { ok: true, lead: updated, error: null };
}

/** Which new leads get a line without being asked: reachable, and not weak. */
const worthAnOpener = (l) => l.status === 'new' && ['high', 'medium'].includes(l.emailConfidence) && l.fit >= 50 && (!l.opener || l.openerState === 'none');

/**
 * Lines for leads a run just found, best first, until `max` or the deadline.
 * Stops at the first "no keys" — nothing after it would work either.
 */
async function writeOpenersFor(userId, leadIds, { max = 5, deadline = Infinity, signal } = {}) {
  if (!leadIds.length) return { written: 0, failed: 0 };
  const leads = (await Lead.find({ _id: { $in: leadIds }, userId }).sort({ fit: -1 }).lean()).filter(worthAnOpener).slice(0, max);
  const profile = (await Profile.findOne({ userId }).lean()) || {};
  let written = 0; let failed = 0;
  for (const l of leads) {
    if (Date.now() > deadline) break;
    const r = await writeOpener(userId, l._id, { profile, signal });
    if (r.noKeys) break;
    if (r.ok) written++; else failed++;
  }
  return { written, failed };
}

module.exports = { writeOpener, writeOpenersFor, checkOpener, factsFor, resultsFor, buildPrompt, worthAnOpener, MIN, MAX };
