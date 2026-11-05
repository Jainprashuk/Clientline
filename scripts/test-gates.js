#!/usr/bin/env node
/**
 * The quality gates and the score, against fixed posts. No network, no database.
 *
 *   node scripts/test-gates.js
 */
const { judge, placeOf, parseBudget } = require('../lib/leads/gates');
const { score } = require('../lib/leads/score');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const eq = (got, want, m) => (got === want ? ok(m) : bad(`${m} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

const NOW = new Date('2026-11-04T10:00:00Z');
const days = (n) => new Date(NOW - n * 86400000);

const profile = {
  services: [
    { name: 'React web apps', keywords: ['react', 'next.js', 'web app', 'frontend'], minBudget: 30000 },
    { name: 'Landing pages', keywords: ['landing page', 'website'], minBudget: 0 },
  ],
  currency: 'INR', rate: 1500, minProject: 25000,
  clientTypes: ['startups'], locations: ['india'], remoteOk: true,
  exclusions: ['wordpress', 'equity only'],
};

const item = (text, extra = {}) => ({
  source: 'paste', sourceType: 'asked', text, postedAt: days(1),
  emails: [{ email: 'a@acme.in', confidence: 'high' }], emailConfidence: 'high',
  signals: [{ text: 'posted', source: 'test', url: null }], ...extra,
});
const v = (text, extra) => judge(item(text, extra), profile, NOW);

console.log('Gate 1 — a real client:');
eq(v('Hi all, I am a freelance React developer available for new projects. DM me!').verdict, 'drop', 'freelancer advertising -> drop');
eq(v('We offer affordable website design. Our services include React apps.').verdict, 'drop', 'agency pitch -> drop');
eq(v('React dev here, looking for freelance work and new clients').verdict, 'drop', 'looking for work -> drop');
eq(v('Our startup is looking for a freelance React developer to build our web app, budget ₹80,000').verdict, 'keep', 'client asking -> keep');
eq(v('Need help with our Next.js frontend, anyone?').verdict, 'keep', '"need help with" -> keep');
eq(v('Just shipped a new React web app, so proud of the team').verdict, 'drop', 'no ask -> drop');
eq(v('Hiring: full-time React developer, CTC 12 LPA, join our team as a frontend engineer').verdict, 'drop', 'full-time job -> drop');
eq(v('Looking for a React developer, contract role for 3 months, ₹1.5 lakh').verdict, 'keep', 'contract role -> keep');
eq(v('I am a freelance dev', { ai: { needsFreelancer: true, selfPromo: false } }).reason.includes('services'), true, 'AI reading overrides the regex (then judged on service)');

eq(v("hello everyone, i'm a full-stack developer who was recently laid off and looking for some quick work in React").verdict, 'drop', 'laid-off developer -> drop');
eq(v('MSI is an India-based technology development partner offering React web app development').verdict, 'drop', 'agency describing itself -> drop');
// The Iconceptz post: a list of services, then an offer to the reader. Even an AI reading
// that called it a client request doesn't keep it.
const iconceptz = 'corporate website design, UI/UX, responsive development, custom functionality, integrations, performance optimisation and ongoing maintenance. We can work on a new website or improve an existing one, depending on your needs.';
eq(v(iconceptz).verdict, 'drop', 'agency offering to work on your website -> drop');
eq(v(iconceptz, { ai: { needsFreelancer: true, selfPromo: false } }).verdict, 'drop', 'seller pitch overrules an AI reading');
eq(v('We specialise in Shopify stores for D2C brands. DM us to discuss your project.').verdict, 'drop', 'we specialise in -> drop');
eq(v('Looking for a freelance React developer to rebuild our checkout, contract role, budget flexible depending on your experience.').verdict === 'drop' && v('Looking for a freelance React developer to rebuild our checkout, contract role, budget flexible depending on your experience.').reason.includes('advertising'), false, 'a client mentioning "your experience" is not a pitch');
eq(v('We are looking for a skilled ReactJS Developer to design and maintain our web app', { source: 'web-post' }).reason, 'Reads like a job opening, not freelance work', 'web job opening -> drop');
eq(v('We are looking for a freelance ReactJS developer for a 6 week web app project', { source: 'web-post' }).verdict, 'keep', 'web freelance ask -> keep');

console.log('\nGate 2 — fresh:');
eq(v('Looking for a React developer for our web app', { source: 'web-post', postedAt: days(10) }).verdict, 'drop', 'web post 10 days old -> drop');
eq(v('Looking for a React developer for our web app', { source: 'hn', postedAt: days(30) }).verdict, 'keep', 'HN post 30 days old -> keep');
eq(v('Looking for a React developer for our web app', { postedAt: null }).verdict, 'keep', 'no date -> neutral');

console.log('\nGate 3 — fits the profile:');
eq(v('Looking for a Flutter developer for our mobile app').reason, 'Not one of your services', 'other service -> drop');
eq(v('Need a developer to fix our WordPress website').verdict, 'drop', 'excluded word -> drop');
eq(v('Looking for a React developer, budget $150').verdict, 'drop', 'budget below minimum -> drop');
eq(v('Looking for a React developer, budget $2,000 - $5,000').verdict, 'keep', 'budget above minimum -> keep');
eq(v('Need a React developer for a web app, $8/hr').verdict, 'drop', 'hourly well below rate -> drop');
eq(v('Looking for a React developer, US only, remote').verdict, 'drop', 'US-only remote -> drop');
eq(v('Looking for a React developer in Berlin for our web app').verdict, 'drop', 'named elsewhere -> drop');
eq(v('Looking for a React developer in Bengaluru for our web app').verdict, 'keep', 'named wanted city -> keep');
eq(v('Looking for a React developer, fully remote, anywhere').verdict, 'keep', 'global remote -> keep');
eq(judge(item('Looking for a React developer, remote from Germany'), { ...profile, remoteOk: false }, NOW).verdict, 'drop', 'remote from elsewhere with remoteOk off -> drop');

console.log('\nGate 4/5 — reason and reachability:');
eq(v('Looking for a React developer', { signals: [] }).verdict, 'drop', 'no signal -> drop');
eq(v('Looking for a React developer', { emails: [] }).verdict, 'held', 'no email -> held');

console.log('\nGate 7 — red flags:');
eq(v('Looking for a React developer, first an unpaid test task').verdict, 'drop', 'unpaid test -> drop');
eq(v('Need a React developer, payment after we launch').verdict, 'drop', 'pay after launch -> drop');
eq(v('Need a React developer urgently, budget ₹30,000').reason, 'Red flag: urgent with a small budget', 'urgent + small budget -> drop');

console.log('\nTriggers (funding news) are judged on the client, not keywords:');
eq(judge(item('Acme raises $2M seed round to build AI bookkeeping', { source: 'news', sourceType: 'trigger' }), profile, NOW).verdict, 'keep', 'funding headline -> keep');
eq(judge(item('Acme raises $2M seed round to build AI bookkeeping', { source: 'news', sourceType: 'trigger' }), profile, NOW).budget, null, 'a funding round is not a project budget');

console.log('\nExclusions:');
const unpaidProfile = { ...profile, exclusions: ['unpaid', 'wordpress'] };
const u = (text) => judge(item(text), unpaidProfile, NOW);
eq(u('Looking for a freelance React developer. 60 to 90 minutes, unpaid, take-home first. Budget ₹80,000').verdict, 'drop', '"unpaid" said of the work -> drop');
eq(u('Looking for a freelance React developer, budget ₹80,000. We never ask for unpaid work.').verdict, 'keep', '"never ask for unpaid work" -> not excluded');
eq(u('Looking for a freelance React developer for our Next.js app, budget ₹80,000 — no WordPress please').verdict, 'keep', '"no WordPress" -> not excluded');
eq(u('Need a freelance developer to fix our WordPress site, budget ₹80,000').verdict, 'drop', 'a WordPress job -> excluded');

console.log('\nParsing:');
eq(parseBudget('budget ₹50,000').inr, 50000, '₹50,000');
eq(parseBudget('Rs. 1.5 lakh').inr, 150000, 'Rs. 1.5 lakh');
eq(parseBudget('$2k-$5k').amount, 5000, 'range -> the top');
eq(parseBudget('3000 USD').currency, 'USD', '3000 USD');
eq(parseBudget('$40/hr').hourly, true, '$40/hr is hourly');
eq(parseBudget('Part-time or Contract | $55 - $75/hr').hourly, true, '$55 - $75/hr is hourly throughout');
eq(v('Looking for a contract React developer, $55 - $75/hr').verdict, 'keep', 'hourly range above rate -> keep');
eq(parseBudget('founded in 2019 with 12 people'), null, 'no money');
eq(placeOf('Remote (worldwide)', { locations: ['india'] }), 'global', 'worldwide remote');
eq(placeOf('Based in Indiana', { locations: ['india'] }), 'unknown', '"Indiana" is not India');
eq(placeOf('Software Engineer | REMOTE (Canada) | Contract', { locations: ['india', 'remote'] }), 'elsewhere', '"remote" in the profile does not make REMOTE (Canada) wanted');

console.log('\nScore:');
const it = item('Our startup is looking for a freelance React developer for a Next.js web app, budget ₹80,000, Bengaluru');
const s = score(it, judge(it, profile, NOW), profile, NOW);
s.fit >= 75 ? ok(`strong lead scores ${s.fit}`) : bad(`strong lead scored ${s.fit}`);
s.fitWhy.every(w => /^\+\d+: /.test(w)) ? ok('every point has a reason') : bad('a point without a reason');
const thin = item('Need help with our frontend', { emails: [], emailConfidence: null, postedAt: null });
const t = score(thin, judge(thin, profile, NOW), profile, NOW);
t.fit < 75 ? ok(`thin lead scores ${t.fit}`) : bad(`thin lead scored ${t.fit}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
