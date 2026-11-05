/**
 * A lead's whole first email, written by the user's own AI chain in a fixed shape:
 *
 *   their ask (or, for news, what just happened)  → one piece of matching work, with
 *   its link → how I'd approach it → an easy next step → signature.
 *
 * The model writes only the subject and the middle parts (ask, proof, approach), as
 * JSON; the greeting, the link, the closing question and the signature are added
 * here, so the shape can't drift and no link is ever the model's choice.
 * checkFirstEmail() rejects anything made up (lib/leads/factCheck.js), filler,
 * a copy of their post, a news lead told it "needs" something, and the wrong
 * length; completeChecked retries with the reason, then tries the next provider.
 */
const Lead = require('../../models/Lead');
const Profile = require('../../models/Profile');
const Settings = require('../../models/Settings');
const { completeChecked, parseJson } = require('../ai/complete');
const { factsFor, BANNED, GREETING } = require('../leads/opener');
const { claimsOutside, speaksTo, longestCopy } = require('../leads/factCheck');
const { rankCases } = require('./cases');
const { valuesFor } = require('./render');

const WORDS = { min: 60, max: 170 };
const EXTRA_BANNED = /\b(i'?d love to|i'?m confident|my expertise|help you achieve|next level|don'?t hesitate|feel free to|seamless(?:ly)?|robust|elevate|empower|unlock|delighted|thrilled|excited to)\b/i;
const PUSHY = /\b(?:hop|jump) on\b|\bschedule\b|\bcalendly\b|\bzoom\b|\bbook a\b/i;
const CLAIMS_THEY_ASKED = /\byou(?:'re|’re| are)?\s+(?:need|needs|needed|looking for|asked|posted|want(?:ed)?|searching)\b/i;
const LAZY_START = /^\s*(?:you posted|i saw|i noticed|i came across|i read your|your post)\b/i;
const BAD_SUBJECT = /\b(?:quick (?:question|idea)|following up|urgent|free|guaranteed|re:|fwd:)\b|[!?]/i;

/** How we found them decides the shape: they asked, or something happened to them. */
const shapeOf = (lead) => (lead.sourceType === 'trigger' ? 'event' : 'asked');

const SHAPES = {
  asked: `They publicly asked for help. Write to them as "you".
- subject: 3-7 words, lowercase start, naming their project in their terms (e.g. "your checkout rebuild before diwali"). No "quick question", no punctuation at the end.
- ask: ONE sentence naming the specific thing they need, using a concrete detail from the LEAD facts (a tool, a deadline, the problem). Don't retell the whole post. Don't start with "You posted", "I saw" or "Your post".
- proof: ONE sentence, first person, about the PROOF work, its numbers exactly as written. Empty string if there is no PROOF.
- approach: 1-2 sentences on how I'd start on THEIR problem, as a suggestion ("I'd start with…", "I'd ship it in stages so…"). Never state facts about them that aren't in the LEAD facts.`,
  event: `They did NOT ask for anything: something just happened to them (see the LEAD facts). Never say they need, want or asked for anything.
- subject: 3-7 words, lowercase start, about the news (e.g. "congrats on the seed round").
- ask: ONE sentence congratulating them on the specific news, as "you".
- proof: ONE sentence, first person, about the PROOF work, its numbers exactly as written. Empty string if there is no PROOF.
- approach: 1-2 sentences: what companies at this stage often need that I do (as a general pattern, "Teams that just raised often…"), and what I'd do first.`,
};

const SYSTEM = (shape) => `You write the middle of a short, plain cold email from a freelancer to a possible client.
${SHAPES[shape]}
Rules for every part:
- Use ONLY the facts under LEAD, ME and PROOF. Never add a number, name, link, company, result or claim that isn't written there.
- Peer to peer, specific, no flattery, no hype. No greeting, no sign-off, no links (they're added after), no question asking for a call or meeting.
- Never use: passionate, expertise, leverage, seamless, robust, elevate, "I'd love to", "I'm confident", "help you achieve", "reaching out", "next level".
Return JSON only: {"subject": "...", "ask": "...", "proof": "...", "approach": "...", "used": ["F1", "R1"]} — "used" lists every fact id you relied on.`;

/** What the email's last line asks: one easy question, the same for every lead of a shape. */
function nextStep(shape, profile) {
  const avail = String(profile.availability || '').trim().replace(/\.+$/, '');
  const q = shape === 'event' ? 'Worth me sending a short plan for how I’d help?' : 'Want me to send a short plan and a ballpark price? A one-word reply is enough.';
  return avail ? `${avail.charAt(0).toUpperCase()}${avail.slice(1)}. ${q}` : q;
}

function buildPrompt(lead, profile, facts, proof) {
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
    lead.service ? `The service this lead needs: ${lead.service}` : '',
    profile.howIWork ? `How I work: ${profile.howIWork}` : '',
    '',
    proof ? `PROOF\nR1: ${proof.title} — ${proof.result}${proof.client ? ` (for a ${proof.client})` : ''}` : 'PROOF\n(none — leave "proof" empty)',
  ].filter(s => s !== '').join('\n');
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Pure: the finished email from the model's parts. */
function assemble(parts, { lead, profile, settings = {}, shape, proof }) {
  const v = valuesFor(lead, profile, settings);
  const link = proof ? (proof.url || profile.portfolioUrl || '') : '';
  const proofPara = parts.proof ? `${clean(parts.proof)}${link ? `\n${link}` : ''}` : '';
  const name = v.myName || profile.name || '';
  // With no proof link, the portfolio goes under the name — still one link at most.
  const sigLink = !link && profile.portfolioUrl ? profile.portfolioUrl : '';
  const signature = [name, [profile.headline, sigLink].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  const body = [`Hi ${v.first},`, clean(parts.ask), proofPara, clean(parts.approach), nextStep(shape, profile), signature]
    .filter(Boolean).join('\n\n');
  return { subject: clean(parts.subject), body, link: link || sigLink || null };
}

const wordCount = (s) => (String(s).match(/\S+/g) || []).length;

/**
 * Pure: null when the model's answer is a usable email, else the reason.
 * ctx: { lead, facts, profile, settings, shape, proof }
 */
function checkFirstEmail(raw, ctx) {
  const { lead, facts, profile, shape, proof } = ctx;
  const d = parseJson(raw);
  if (!d || ['subject', 'ask', 'approach'].some(k => typeof d[k] !== 'string')) return 'not the JSON asked for';
  const subject = clean(d.subject); const ask = clean(d.ask); const approach = clean(d.approach); const proofText = clean(d.proof);

  const sw = wordCount(subject);
  if (sw < 2 || sw > 8 || subject.length > 60) return `the subject should be 3-7 words (got ${sw})`;
  if (BAD_SUBJECT.test(subject)) return 'the subject sounds like a sales email (no "quick question", "free", "!" or "?")';
  if (ask.length < 30 || ask.length > 320) return 'the first sentence should be one sentence about them (30-320 characters)';
  if (approach.length < 40 || approach.length > 400) return 'the approach should be 1-2 sentences (40-400 characters)';
  if (proof && !proofText) return 'use the PROOF work in one sentence';
  if (!proof && proofText) return 'there is no PROOF, so "proof" must be empty';
  if (proofText.length > 320) return 'the proof should be one sentence';

  const parts = [subject, ask, proofText, approach];
  const all = parts.join('\n');
  for (const p of [ask, proofText, approach]) if (p && GREETING.test(p)) return 'a part starts with a greeting';
  if (BANNED.test(all) || EXTRA_BANNED.test(all)) return 'uses boilerplate or sales words';
  if (/https?:\/\/|www\.|@\w/.test(all)) return 'contains a link or address (links are added for you)';
  if (PUSHY.test(all)) return 'asks for a call or meeting (the email offers a short plan instead)';
  if (shape === 'asked' && LAZY_START.test(ask)) return 'opens with "You posted / I saw" — name what they need instead';
  if (shape === 'event' && (CLAIMS_THEY_ASKED.test(ask) || CLAIMS_THEY_ASKED.test(approach))) return 'says they need or asked for something, but they never asked';

  const shown = [
    lead.name, lead.person, lead.title, lead.service, ...facts.map(f => f.text),
    proof ? `${proof.title} ${proof.result} ${proof.client || ''}` : '',
    profile.name, profile.headline, profile.howIWork, profile.availability, ...(profile.services || []).map(s => s.name),
  ].join(' ');
  const outside = claimsOutside(all, shown);
  if (outside) return outside;
  if (!speaksTo(`${subject} ${ask}`, lead, facts)) return 'the subject and first sentence don’t mention anything specific to this lead';
  if (longestCopy(all, facts.map(f => f.text).join(' ')) > 12) return 'copies their post word for word — say it in your own words';
  const ids = new Set([...facts.map(f => f.id), ...(proof ? ['R1'] : [])]);
  const used = Array.isArray(d.used) ? d.used.filter(u => ids.has(u)) : [];
  if (!used.some(u => u.startsWith('F'))) return 'does not say which lead fact it used';

  const words = wordCount(assemble({ subject, ask, proof: proofText, approach }, ctx).body);
  if (words < WORDS.min || words > WORDS.max) return `the whole email should be ${WORDS.min}-${WORDS.max} words (got ${words})`;
  return null;
}

/**
 * Writes (or rewrites) one lead's first email and stores it on the lead.
 * `useCase`: a case title to cite instead of the best match ("Use a different case").
 * @returns {Promise<{ok: boolean, lead: object|null, error: string|null, noKeys?: boolean}>}
 */
async function writeFirstEmail(userId, leadId, { profile = null, settings = null, useCase = null, signal } = {}) {
  const lead = await Lead.findOne({ _id: leadId, userId }).lean();
  if (!lead) return { ok: false, lead: null, error: 'No such lead' };
  const p = profile || (await Profile.findOne({ userId }).lean()) || {};
  const s = settings || (await Settings.findOne({ userId }, { senderName: 1, bookingUrl: 1 }).lean()) || {};
  const facts = factsFor(lead);
  if (!facts.length) return { ok: false, lead, error: 'Nothing on this lead to write from' };
  const shape = shapeOf(lead);
  const proof = (useCase && (p.cases || []).find(c => c.title === useCase)) || rankCases(p, lead)[0] || null;

  const ctx = { lead, facts, profile: p, settings: s, shape, proof };
  const r = await completeChecked(userId,
    { system: SYSTEM(shape), prompt: buildPrompt(lead, p, facts, proof), maxTokens: 500, temperature: 0.5, json: true },
    { feature: 'opener', check: (text) => checkFirstEmail(text, ctx), signal, context: { leadId: String(lead._id), company: lead.name } });

  if (!r.ok) {
    if (r.noKeys) return { ok: false, lead, error: r.error, noKeys: true };
    const updated = await Lead.findOneAndUpdate({ _id: lead._id, userId },
      { $set: { 'firstEmail.state': 'failed', 'firstEmail.error': String(r.error || '').slice(0, 300), 'firstEmail.at': new Date() } },
      { returnDocument: 'after' }).lean();
    return { ok: false, lead: updated, error: r.error };
  }
  const d = parseJson(r.text);
  const email = assemble(d, ctx);
  const byId = Object.fromEntries(facts.map(f => [f.id, f.label]));
  const sources = [...new Set((d.used || []).map(u => byId[u]).filter(Boolean))];
  const updated = await Lead.findOneAndUpdate({ _id: lead._id, userId }, {
    $set: {
      firstEmail: {
        subject: email.subject, body: email.body, shape, caseTitle: proof ? proof.title : null, link: email.link,
        sources, state: 'written', error: null, at: new Date(),
      },
    },
  }, { returnDocument: 'after' }).lean();
  return { ok: true, lead: updated, error: null };
}

/** Which new leads get an email without being asked: reachable, and not weak. */
const worthAnEmail = (l) => ['new', 'approved'].includes(l.status) && ['high', 'medium'].includes(l.emailConfidence) && l.fit >= 50
  && !(l.firstEmail && ['written', 'edited'].includes(l.firstEmail.state));

/** Emails for leads a run just found, best first, until `max` or the deadline. */
async function writeFirstEmailsFor(userId, leadIds, { max = 5, deadline = Infinity, signal } = {}) {
  if (!leadIds.length) return { written: 0, failed: 0 };
  const leads = (await Lead.find({ _id: { $in: leadIds }, userId }).sort({ fit: -1 }).lean()).filter(worthAnEmail).slice(0, max);
  const profile = (await Profile.findOne({ userId }).lean()) || {};
  const settings = (await Settings.findOne({ userId }, { senderName: 1, bookingUrl: 1 }).lean()) || {};
  let written = 0; let failed = 0;
  for (const l of leads) {
    if (Date.now() > deadline) break;
    const r = await writeFirstEmail(userId, l._id, { profile, settings, signal });
    if (r.noKeys) break;
    if (r.ok) written++; else failed++;
  }
  return { written, failed };
}

/** What would make this account's emails stronger, for the profile and the drawer. */
function emailStrength(profile) {
  const p = profile || {};
  const covered = new Set((p.cases || []).map(c => c.service).filter(Boolean));
  return [
    { key: 'name', ok: !!p.name, label: 'Your name' },
    { key: 'headline', ok: !!p.headline, label: 'One line about you' },
    { key: 'portfolioUrl', ok: !!p.portfolioUrl, label: 'A portfolio or website link' },
    ...(p.services || []).map(s => ({ key: `case:${s.name}`, ok: covered.has(s.name), label: `A piece of work for “${s.name}”` })),
  ];
}

module.exports = { writeFirstEmail, writeFirstEmailsFor, checkFirstEmail, assemble, buildPrompt, nextStep, shapeOf, emailStrength, worthAnEmail, WORDS };
