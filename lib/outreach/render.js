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
];
const KEYS = VARIABLES.map(v => v.key);
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
  const values = valuesFor(lead, profile, settings);
  const text = `${step.subject || ''}\n${step.body || ''}`;
  const { used, unknown } = variablesIn(text);
  const missing = used.filter(k => !String(values[k] || '').trim());
  if (unknown.length || missing.length) return { ok: false, missing, unknown };
  const fill = (s) => String(s || '').replace(TOKEN, (_, k) => values[k]).replace(/[ \t]+\n/g, '\n').trim();
  return { ok: true, subject: fill(step.subject), body: fill(step.body) };
}

/** Human words for a blocked render. */
function whyBlocked(r) {
  const label = (k) => (VARIABLES.find(v => v.key === k) || { label: `{{${k}}}` }).label.toLowerCase();
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
    {
      kind: 'email', dayOffset: 0,
      subject: 'Quick idea for {{company}}',
      body: 'Hi {{first}},\n\n{{opener}}\n\nI’m {{myName}} — {{myHeadline}}. If it’s useful, I can send a short note on how I’d approach it. No call needed.\n\n{{myName}}',
    },
    {
      kind: 'email', dayOffset: 3, subject: '',
      body: 'Hi {{first}},\n\nBringing this back up in case it got buried. Would a short note on how I’d handle {{service}} for {{company}} help?\n\n{{myName}}',
    },
    {
      kind: 'email', dayOffset: 7, subject: '',
      body: 'Hi {{first}},\n\nI’ll leave it here so I don’t crowd your inbox. If {{service}} comes up later, I’m one reply away.\n\n{{myName}}',
    },
  ],
};

module.exports = { renderStep, valuesFor, variablesIn, whyBlocked, missingYours, VARIABLES, KEYS, STARTER };
