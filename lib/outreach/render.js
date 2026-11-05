/**
 * Fills a sequence step for one lead. Pure.
 *
 * Unlike Outreach's lib/renderTemplate.js (which leaves an unknown value blank),
 * a variable that would come out empty here BLOCKS the email for that lead and
 * says which one — an email must never go out as "Hi ,". The only soft one is
 * {{first}}, which falls back to "there" because most leads are a company, not a
 * named person.
 */
const VARIABLES = [
  { key: 'first', label: 'Their first name (or “there”)' },
  { key: 'name', label: 'Their full name, or the company' },
  { key: 'company', label: 'The company' },
  { key: 'opener', label: 'The lead’s first line' },
  { key: 'service', label: 'The service they need' },
  { key: 'myName', label: 'Your name', where: 'Free connections → Gmail (your name), or My profile' },
  { key: 'myHeadline', label: 'Your one line about you', where: 'My profile' },
  { key: 'bookingLink', label: 'Your booking link', where: 'Free connections → Gmail (booking link)' },
  { key: 'theirAsk', label: 'What they need, in a few words (from their first email)' },
  // Optional: left out (with its blank line) when there's nothing to put.
  { key: 'caseLine', label: 'Another piece of your work that fits, or your portfolio', optional: true },
  { key: 'portfolio', label: 'Your portfolio link', optional: true },
];
const OPTIONAL = new Set(VARIABLES.filter(v => v.optional).map(v => v.key));
const KEYS = VARIABLES.map(v => v.key);
const { caseLine } = require('./cases');
const TOKEN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

// Words that read as a title, not a first name ("Hi Founder,").
const NOT_A_NAME = /^(?:hr|team|hiring|founder|ceo|cto|the|mr|ms|mrs|dr|hn|user)$/i;

// "Web apps (React / Next.js)" reads as "web apps" in a sentence. Only ordinary words are
// lowercased; names (Shopify, WordPress) and acronyms (SEO, UI/UX) keep their case.
const ORDINARY = new Set(['web', 'apps', 'app', 'websites', 'website', 'landing', 'pages', 'page', 'mobile', 'logos', 'logo', 'branding',
  'content', 'copywriting', 'video', 'editing', 'social', 'media', 'ads', 'data', 'dashboards', 'backend', 'apis', 'design', 'stores',
  'store', 'and', '&', 'automation', 'writing', 'marketing', 'development', 'sites']);
const serviceWords = (name) => String(name || '').replace(/\s*\([^)]*\)/g, '').trim()
  .split(/\s+/).map(w => (ORDINARY.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ');

/** The values for one lead. */
function valuesFor(lead = {}, profile = {}, settings = {}) {
  const firstWord = String(lead.person || '').trim().split(/\s+/)[0] || '';
  const first = firstWord && !NOT_A_NAME.test(firstWord) && /^[A-Za-z][A-Za-z'-]+$/.test(firstWord) ? firstWord : 'there';
  return {
    first,
    name: lead.person || lead.name || '',
    company: lead.name || '',
    opener: lead.opener || '',
    service: serviceWords(lead.service || ((profile.services || [])[0] || {}).name || ''),
    myName: settings.senderName || profile.name || '',
    myHeadline: profile.headline || '',
    bookingLink: settings.bookingUrl || '',
    // The first email's subject names their project ("your checkout rebuild"); a news
    // lead's subject is the congrats, so it falls back to the service.
    theirAsk: (lead.firstEmail && lead.firstEmail.shape === 'asked' && lead.firstEmail.subject)
      || [serviceWords(lead.service || ''), lead.name].filter(Boolean).join(' for '),
    caseLine: lead.name ? caseLine(profile, lead) : '',
    portfolio: profile.portfolioUrl || '',
  };
}

/** The variables a piece of text uses, and any it uses that don't exist. */
function variablesIn(text) {
  const used = new Set(); const unknown = new Set();
  for (const m of String(text || '').matchAll(TOKEN)) (KEYS.includes(m[1]) ? used : unknown).add(m[1]);
  return { used: [...used], unknown: [...unknown] };
}

/**
 * @returns {{ ok: true, subject, body } | { ok: false, missing: string[], unknown: string[] }}
 */
function renderStep(step, lead, profile, settings) {
  // Step 1 of "First contact": the lead's own email, written for them (lib/outreach/firstEmail.js).
  if (step.useLeadEmail) {
    const e = lead.firstEmail;
    if (!e || !['written', 'edited'].includes(e.state) || !e.subject || !e.body) return { ok: false, missing: ['firstEmail'], unknown: [] };
    return { ok: true, subject: e.subject, body: e.body };
  }
  const values = valuesFor(lead, profile, settings);
  const text = `${step.subject || ''}\n${step.body || ''}`;
  const { used, unknown } = variablesIn(text);
  const missing = used.filter(k => !OPTIONAL.has(k) && !String(values[k] || '').trim());
  if (unknown.length || missing.length) return { ok: false, missing, unknown };
  const fill = (s) => String(s || '').replace(TOKEN, (_, k) => values[k]).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { ok: true, subject: fill(step.subject), body: fill(step.body) };
}

/** Human words for a blocked render. */
function whyBlocked(r) {
  const label = (k) => (VARIABLES.find(v => v.key === k) || { label: `{{${k}}}` }).label.toLowerCase();
  if (r.missing && r.missing.includes('firstEmail')) return 'Its first email isn’t written yet — open the lead and write it';
  if (r.unknown && r.unknown.length) return `The email uses ${r.unknown.map(k => `{{${k}}}`).join(', ')}, which isn't a variable`;
  const yours = r.missing.map(k => VARIABLES.find(v => v.key === k)).filter(v => v && v.where);
  if (yours.length === r.missing.length) return `Missing ${yours.map(v => `${v.label.toLowerCase()} — add it in ${v.where}`).join('; ')}`;
  return `Missing ${r.missing.map(label).join(', ')}`;
}

/** Your own details a running sequence uses but you haven't filled in: [{key, label, where}]. */
function missingYours(sequences, profile, settings) {
  const v = valuesFor({}, profile || {}, settings || {});
  const used = new Set(sequences.filter(s => s.active).flatMap(s => s.steps.flatMap(st => variablesIn(`${st.subject || ''} ${st.body || ''}`).used)));
  return VARIABLES.filter(x => x.where && used.has(x.key) && !v[x.key]);
}

/** The ready-made sequence every account starts with. */
const STARTER = {
  name: 'First contact',
  newPerDay: 15,
  steps: [
    // Each lead's own email: their ask, one matching piece of your work, how you'd start, a short-plan offer.
    { kind: 'email', dayOffset: 0, useLeadEmail: true, subject: '', body: '' },
    {
      kind: 'email', dayOffset: 3, subject: '',
      body: 'Hi {{first}},\n\nBringing this back up in case it got buried — still happy to send a short plan and a ballpark price for {{theirAsk}}.\n\n{{caseLine}}\n\nA one-word reply is enough.\n\n{{myName}}',
    },
    {
      kind: 'email', dayOffset: 7, subject: '',
      body: 'Hi {{first}},\n\nI’ll leave this here so I don’t crowd your inbox. If {{theirAsk}} comes back up, reply any time and I’ll send the plan.\n\n{{myName}}',
    },
  ],
};

module.exports = { renderStep, valuesFor, variablesIn, whyBlocked, missingYours, VARIABLES, KEYS, STARTER };
