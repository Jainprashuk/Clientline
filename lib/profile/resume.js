/**
 * "Fill from resume": the user's own AI chain reads the resume's text (pulled out
 * in the browser — the file never reaches us) and suggests profile fields. Nothing
 * is saved here; the profile page shows the suggestions to tick and then save.
 *
 * Honest by construction: every number, name and link in a suggestion must be in
 * the resume (lib/leads/factCheck.js), a project without a stated result comes
 * back with the result blank, and services are picked only from the list given.
 */
const { completeChecked, parseJson } = require('../ai/complete');
const { claimsOutside, squash } = require('../leads/factCheck');

const MAX_TEXT = 12_000;
const MAX_PROJECTS = 6;

const SYSTEM = `You read a freelancer's resume and fill in their sales profile. Use ONLY what the resume says.
Return JSON only:
{"name": "...", "headline": "...", "portfolioUrl": "...", "location": "...",
 "services": ["..."], "projects": [{"title": "...", "result": "...", "url": "...", "service": "..."}]}
- name: their full name as written.
- headline: one line a client would read, under 110 characters, in the resume's own terms (e.g. "Full-stack developer building React and Node apps"). Use a number of years only if the resume states it.
- portfolioUrl: their own website or portfolio if listed; else their GitHub; else "". Never a company's site, never LinkedIn.
- location: the city or country they're based in, or "".
- services: from SERVICES only, the ones their work clearly shows (at most 4). Copy the names exactly.
- projects: up to ${MAX_PROJECTS} projects or roles that show work a client could buy, best first.
  - title: under 8 words, what was built ("Checkout rebuild for a D2C brand").
  - result: the measurable outcome exactly as the resume states it (numbers unchanged). If the resume states no result, use "". Never invent or round one.
  - url: a link for this project only if the resume gives one, else "".
  - service: which name from SERVICES it proves, or "".`;

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
// Resumes write "yourname.dev" or "github.com/you"; the profile wants a full link.
const asUrl = (s) => (s && !/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) ? `https://${s}` : s);
const urlOk = (u, text) => /^https?:\/\/\S+$/i.test(u) && squash(text).includes(squash(u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')));

/** Pure: the model's answer, cleaned, or { error }. */
function readAnswer(raw, text, services) {
  const d = parseJson(raw);
  if (!d || typeof d !== 'object' || !Array.isArray(d.projects) || !Array.isArray(d.services)) return { error: 'not the JSON asked for' };
  const out = {
    name: clean(d.name, 80),
    headline: clean(d.headline, 140),
    portfolioUrl: asUrl(clean(d.portfolioUrl, 300)),
    // "Bengaluru, India" → "india": for where clients can be, the country is what matters.
    location: clean(String(d.location || '').split(',').pop(), 40).toLowerCase(),
    services: [...new Set(d.services.map(s => clean(s, 80)).filter(s => services.includes(s)))].slice(0, 4),
    projects: d.projects.slice(0, MAX_PROJECTS).map(p => ({
      title: clean(p && p.title, 120), result: clean(p && p.result, 300), url: asUrl(clean(p && p.url, 300)),
      service: services.includes(clean(p && p.service, 80)) ? clean(p.service, 80) : '',
    })).filter(p => p.title),
  };
  if (out.portfolioUrl && (!urlOk(out.portfolioUrl, text) || /linkedin\.com/i.test(out.portfolioUrl))) out.portfolioUrl = '';
  if (out.name && !squash(text).includes(squash(out.name))) return { error: `the name "${out.name}" isn't in the resume` };
  // Every claim in a headline or project must be in the resume.
  for (const [label, s] of [['the headline', out.headline], ...out.projects.flatMap(p => [[`"${p.title}"`, p.title], [`the result of "${p.title}"`, p.result]])]) {
    const why = s && claimsOutside(s, text);
    if (why) return { error: `${label} ${why.replace(/ in the facts/, ' in the resume')}` };
  }
  for (const p of out.projects) if (p.url && !urlOk(p.url, text)) p.url = '';
  return { suggestion: out };
}

/**
 * @returns {Promise<{ok: boolean, suggestion?: object, error?: string, noKeys?: boolean}>}
 */
async function readResume(userId, rawText, services) {
  const text = String(rawText || '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  if (text.length < 200) return { ok: false, error: 'That’s too little text to read — if it’s a scanned PDF, paste the text instead.' };
  const list = (Array.isArray(services) ? services : []).map(s => clean(s, 80)).filter(Boolean).slice(0, 40);
  let parsed = null;
  const r = await completeChecked(userId,
    { system: SYSTEM, prompt: `SERVICES: ${list.map(s => `"${s}"`).join(', ')}\n\nRESUME\n${text}`, maxTokens: 1200, temperature: 0.2, json: true },
    { feature: 'other', check: (raw) => { const a = readAnswer(raw, text, list); parsed = a.suggestion || null; return a.error || null; }, context: { what: 'resume' } });
  if (!r.ok) return { ok: false, error: r.error, noKeys: !!r.noKeys };
  return { ok: true, suggestion: parsed || readAnswer(r.text, text, list).suggestion };
}

module.exports = { readResume, readAnswer, MAX_TEXT };
