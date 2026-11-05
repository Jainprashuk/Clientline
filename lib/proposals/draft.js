/**
 * A proposal draft for a deal, by the user's own AI chain, from only: what the
 * client wrote (post + thread), your call notes, and your profile (rate, minimum,
 * services, work, how you work). Three options — Essentials, Standard (suggested),
 * Complete — each with a price, weeks and what's included.
 *
 * checkDraft() rejects: a price under your minimum, options that don't rise,
 * an item or claim not in what it was shown (lib/leads/factCheck.js), filler.
 * What it can't know it writes as [a gap]; a proposal with gaps can't be sent.
 */
const Deal = require('../../models/Deal');
const Lead = require('../../models/Lead');
const Profile = require('../../models/Profile');
const Conversation = require('../../models/Conversation');
const { completeChecked, parseJson } = require('../ai/complete');
const { claimsOutside, squash } = require('../leads/factCheck');
const { rankCases } = require('../outreach/cases');
const { theirWords } = require('../deals/create');

const SALESY = /\b(i'?d love to|i'?m confident|my expertise|seamless(?:ly)?|robust|elevate|empower|unlock|cutting[\s-]edge|world[\s-]class|best[\s-]in[\s-]class|synerg\w*|leverage|passionate|delighted|thrilled)\b/i;
const GAP = /\[[^\]\n]{1,60}\]/g;
const STEP = { INR: 1000, USD: 50, EUR: 50, GBP: 50 };   // prices round to this (major units)

const SYSTEM = `You draft a freelancer's proposal: three options for one piece of work.
Use ONLY what is written under CLIENT, NOTES and ME. If you need a fact that isn't there (a page count, an integration, a date), write it as [a short gap] for the freelancer to fill.
- title: under 10 words, what they get ("Checkout rebuild for Brewbox").
- intro: 2-3 sentences to the client ("you"): what they need, in their terms, and how you'd approach it. No flattery, no hype.
- options: exactly 3, named "Essentials", "Standard", "Complete".
  - price: a whole number in CURRENCY, never under MINIMUM; each option costs more than the one before. Base it on MY RATE and THEIR BUDGET when given.
  - weeks: whole weeks; equal or more than the option before.
  - items: 3-6 short lines each (under 12 words) of what's included; each option includes more than the one before. Only work you can see they need, or a [gap].
- suggested: 1 (Standard) unless their budget clearly fits another.
Return JSON only: {"title": "...", "intro": "...", "options": [{"name": "Essentials", "price": 0, "weeks": 0, "items": ["..."]}, …], "suggested": 1}`;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// An item's first word is skipped by the name check (it starts a line), but
// "Shopify integration" or "Stripe payments" names a tool the client never asked for.
const TOOL_NOUN = /^(?:integration|integrations|payments?|plugin|api|apis|connector|sync|gateway|webhooks?)\b/i;
// Ordinary words that start an item without naming a product.
const GENERIC = new Set(['payment', 'payments', 'basic', 'advanced', 'custom', 'admin', 'email', 'sms', 'calendar', 'social', 'crm', 'full',
  'simple', 'booking', 'user', 'data', 'third-party', 'online', 'secure', 'api', 'webhook', 'webhooks', 'login', 'auth', 'search', 'map', 'maps', 'chat', 'cms']);
function toolNotShown(item, shown) {
  const [first, second = ''] = item.split(/\s+/);
  if (!/^[A-Z]/.test(first || '') || GENERIC.has(first.toLowerCase())) return null;
  const brandish = /[a-z][A-Z]|\.[a-z]|\d/.test(first) || TOOL_NOUN.test(second);
  return brandish && !squash(shown).includes(squash(first)) ? first : null;
}
const roundTo = (n, step) => Math.max(step, Math.round(Number(n) / step) * step);

/** Pure: the model's answer as a proposal, or { error }. ctx: { minimum (major), currency, shown } */
function readDraft(raw, ctx) {
  const d = parseJson(raw);
  if (!d || !Array.isArray(d.options) || d.options.length !== 3) return { error: 'needs exactly 3 options' };
  const step = STEP[ctx.currency] || 50;
  const title = clean(d.title).slice(0, 160);
  const intro = clean(d.intro).slice(0, 1500);
  if (!title || title.split(' ').length > 14) return { error: 'the title should be under 10 words' };
  if (intro.length < 60) return { error: 'the intro should be 2-3 sentences to the client' };
  const options = [];
  for (const [i, o] of d.options.entries()) {
    const price = roundTo(o && o.price, step);
    const weeks = Math.round(Number(o && o.weeks));
    const items = (Array.isArray(o && o.items) ? o.items : []).map(clean).filter(Boolean).slice(0, 8);
    if (!Number.isFinite(price) || price <= 0) return { error: `option ${i + 1} has no price` };
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) return { error: `option ${i + 1} needs whole weeks (1-52)` };
    if (items.length < 2) return { error: `option ${i + 1} needs at least 2 items` };
    if (items.some(x => x.split(' ').length > 16)) return { error: 'items should be short lines (under 12 words)' };
    options.push({ name: clean(o.name).slice(0, 60) || ['Essentials', 'Standard', 'Complete'][i], price, weeks, items });
  }
  if (ctx.minimum > 0 && options[0].price < ctx.minimum) return { error: `Essentials (${options[0].price}) is under the MINIMUM (${ctx.minimum})` };
  for (let i = 1; i < 3; i++) {
    if (options[i].price <= options[i - 1].price) return { error: 'each option must cost more than the one before' };
    if (options[i].weeks < options[i - 1].weeks) return { error: 'a bigger option can’t take fewer weeks' };
    if (options[i].items.length < options[i - 1].items.length) return { error: 'each option should include more than the one before' };
  }
  const words = [title, intro, ...options.flatMap(o => o.items)].join('\n');
  if (SALESY.test(words)) return { error: 'uses sales words' };
  // Facts outside what it was shown — gaps are fine, they're for you to fill.
  const shownPlus = `${ctx.shown}\n${options.map(o => o.name).join(' ')} Essentials Standard Complete`;
  // "3 rounds of revisions" is an offer you make, not a claim about anyone.
  const outside = claimsOutside(words.replace(GAP, ' ').replace(/\b\d{1,2}\s+rounds?\s+of\s+(?:changes|revisions|edits)\b/gi, 'rounds of changes'), shownPlus);
  if (outside) return { error: outside };
  for (const it of options.flatMap(o => o.items)) {
    const tool = toolNotShown(it.replace(GAP, ' '), shownPlus);
    if (tool) return { error: `names something that is not in the facts (${tool}) — write it as a [gap] if they may need it` };
  }
  const suggested = [0, 1, 2].includes(Number(d.suggested)) ? Number(d.suggested) : 1;
  options.forEach((o, i) => { o.suggested = i === suggested; o.price *= 100; });   // to minor units
  return { draft: { title, intro, options } };
}

/** The [gaps] still in a proposal (send is refused while there are any). */
function gapsIn(p) {
  const text = [p.title, p.intro, ...(p.options || []).flatMap(o => [o.name, ...(o.items || [])]), p.terms && p.terms.note].join('\n');
  return [...new Set(text.match(GAP) || [])];
}

/** Drafts a proposal for a deal. Returns { ok, draft } or { ok: false, error, noKeys }. */
async function draftProposal(userId, dealId) {
  const deal = await Deal.findOne({ _id: dealId, userId }).lean();
  if (!deal) return { ok: false, error: 'No such deal' };
  const [lead, convo, profile] = await Promise.all([
    deal.leadId ? Lead.findOne({ _id: deal.leadId, userId }).lean() : null,
    deal.conversationId ? Conversation.findOne({ _id: deal.conversationId, userId }).lean() : null,
    Profile.findOne({ userId }).lean(),
  ]);
  const p = profile || {};
  const currency = deal.currency || p.currency || 'INR';
  const minimum = p.currency === currency ? (p.minProject || 0) : 0;
  const client = theirWords(lead, convo).slice(0, 6000);
  const notes = deal.callNotes || {};
  const notesText = [['Budget', notes.budget], ['Timeline', notes.timeline], ['Who decides', notes.decider], ['What done looks like', notes.done], ['Other', notes.other]]
    .filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join('\n');
  const proof = lead ? rankCases(p, lead)[0] : (p.cases || []).find(c => c.title && c.result);
  const terms = p.proposalTerms || {};
  const me = [
    p.name && `Name: ${p.name}`, p.headline && `About me: ${p.headline}`,
    (p.services || []).length && `What I do: ${(p.services || []).map(s => s.name).join(', ')}`,
    p.howIWork && `How I work: ${p.howIWork}`, p.availability && `Availability: ${p.availability}`,
    ...(p.cases || []).filter(c => c.title && c.result).map(c => `Past work: ${c.title} — ${c.result}`),
    `Rounds of changes included: ${terms.rounds == null ? 2 : terms.rounds}`,
  ].filter(Boolean).join('\n');
  const budget = deal.value ? deal.value / 100 : null;
  if (!client.trim() && !notesText) return { ok: false, error: 'There’s nothing from the client to write from yet — add call notes (what they need, what done looks like) first.' };

  const prompt = [
    `CURRENCY: ${currency}`, `MINIMUM: ${minimum || 'none'}`, `MY RATE: ${p.rate ? `${p.rate} ${p.currency} per hour` : 'not given'}`,
    `THEIR BUDGET: ${budget ? `${budget} ${currency}` : notes.budget || 'not given'}`,
    '', `DEAL: ${deal.name} for ${deal.client || 'the client'}`,
    '', 'CLIENT (what they wrote)', client || '(nothing yet)',
    '', 'NOTES (from my call)', notesText || '(none)',
    '', 'ME', me,
  ].join('\n');
  const shown = [deal.name, deal.client, deal.person, client, notesText, me].join('\n');
  let parsed = null;
  const r = await completeChecked(userId, { system: SYSTEM, prompt, maxTokens: 1400, temperature: 0.4, json: true }, {
    feature: 'draft', retries: 2,
    check: (raw) => { const a = readDraft(raw, { minimum, currency, shown }); parsed = a.draft || null; return a.error || null; },
    context: { dealId: String(deal._id) },
  });
  if (!r.ok) return { ok: false, error: r.error, noKeys: !!r.noKeys };
  const draft = parsed || readDraft(r.text, { minimum, currency, shown }).draft;
  return {
    ok: true,
    draft: {
      ...draft, currency,
      terms: { split: terms.split && terms.split.length ? terms.split : [30, 40, 30], rounds: terms.rounds == null ? 2 : terms.rounds, validDays: terms.validDays || 14, note: '' },
      proof: proof ? { title: proof.title, result: proof.result, url: proof.url || '' } : null,
    },
  };
}

module.exports = { draftProposal, readDraft, gapsIn, SYSTEM };
