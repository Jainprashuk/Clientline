#!/usr/bin/env node
/**
 * The whole first email: what the checker lets through, how the email is put
 * together from the model's parts, which piece of work it cites, and the
 * sequence step that sends it. No network, no database.
 *
 *   node scripts/test-first-email.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { checkFirstEmail, assemble, nextStep } = require('../lib/outreach/firstEmail');
const { factsFor } = require('../lib/leads/opener');
const { rankCases, caseLine } = require('../lib/outreach/cases');
const { renderStep, whyBlocked, STARTER } = require('../lib/outreach/render');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };
const ok = (cond, m) => eq(!!cond, true, m);

const profile = {
  name: 'Prashuk Jain', headline: 'Freelance React & Next.js developer', portfolioUrl: 'https://prashuk.dev',
  howIWork: 'Fixed price after a short call, a demo every week',
  services: [{ name: 'Web apps', keywords: ['react', 'next.js', 'checkout'] }, { name: 'Websites', keywords: ['website', 'landing page'] }],
  cases: [
    { title: 'D2C checkout rebuild', result: 'Mobile conversion up 18% in the first month', url: 'https://prashuk.dev/work/checkout', service: 'Web apps', client: 'D2C brand' },
    { title: 'Clinic booking site', result: 'Online bookings doubled in 6 weeks', url: '', service: 'Websites' },
    { title: 'Inventory dashboard', result: 'Cut stock reconciliation from 2 days to 2 hours', url: '', service: 'Web apps' },
  ],
};
const lead = {
  name: 'Brewbox', person: 'Ritika Sharma', service: 'Web apps', sourceType: 'asked',
  about: 'We need a freelance React developer to rebuild our checkout before the Diwali sale. Most carts drop off on mobile at the payment step.',
  signals: [{ text: '“We need a freelance React developer to rebuild our checkout before the Diwali sale.”', source: 'LinkedIn post' }],
};
const facts = factsFor(lead);
const proof = rankCases(profile, lead)[0];
const ctx = { lead, facts, profile, settings: { senderName: 'Prashuk Jain' }, shape: 'asked', proof };
const good = {
  subject: 'your checkout rebuild before diwali',
  ask: 'You need the Brewbox checkout rebuilt before the Diwali sale, and mobile is where carts drop off.',
  proof: 'I rebuilt a D2C checkout last year and mobile conversion went up 18% in the first month.',
  approach: 'For yours I’d start with the mobile payment step, then ship the rest in stages so nothing is at risk during the sale.',
  used: ['F1', 'R1'],
};
const check = (patch, c = ctx) => checkFirstEmail(JSON.stringify({ ...good, ...patch }), c);

console.log('Picking the work to cite:');
eq(proof && proof.title, 'D2C checkout rebuild', 'the case for their service, sharing their words, comes first');
eq(rankCases(profile, { ...lead, service: 'Websites', about: 'need a landing page' })[0].title, 'Clinic booking site', 'a Websites lead gets the Websites case');
eq(rankCases({ ...profile, cases: [] }, lead).length, 0, 'no cases: no proof');
ok(caseLine(profile, { ...lead, firstEmail: { caseTitle: 'D2C checkout rebuild' } }).includes('Inventory dashboard'), 'the follow-up cites the next case, not the same one');
ok(caseLine({ ...profile, cases: [] }, lead).includes('https://prashuk.dev'), 'no other case: the portfolio');

console.log('\nThe checker:');
eq(check({}), null, 'a good email passes');
ok(/number/.test(check({ proof: 'I rebuilt a D2C checkout and mobile conversion went up 40% in the first month.' })), 'a made-up number is rejected');
ok(/link/.test(check({ approach: 'See https://example.com for how I’d start on the mobile payment step for your sale.' })), 'a link written by the model is rejected');
ok(/sales words|boilerplate/.test(check({ approach: 'I’d love to help you achieve a seamless checkout before the Diwali sale with my expertise.' })), 'filler is rejected');
ok(/You posted/.test(check({ ask: 'You posted that you need a freelance React developer for the Brewbox checkout.' })), '"You posted…" opening is rejected');
ok(/copies/.test(check({ ask: 'We need a freelance React developer to rebuild our checkout before the Diwali sale, I read.' })), 'copying their post word for word is rejected');
ok(/call|meeting/.test(check({ approach: 'Let’s hop on a call this week and I’ll walk you through the mobile payment step for the sale.' })), 'asking for a call is rejected');
ok(/subject/.test(check({ subject: 'Quick question!' })), 'a salesy subject is rejected');
ok(/proof/i.test(check({ proof: '' })), 'leaving out the proof when there is one is rejected');
ok(/PROOF/.test(check({}, { ...ctx, proof: null })), 'inventing proof when there is none is rejected');
eq(check({ proof: '' }, { ...ctx, proof: null }), null, 'no proof in the profile: the email goes without it');
ok(/names something/.test(check({ proof: 'I rebuilt a checkout for Nykaa and mobile conversion went up 18% in the first month.' })), 'a client name not in the profile is rejected');
ok(/fact/.test(check({ used: [] })), 'not saying which fact it used is rejected');

const newsLead = { name: 'Venttup', sourceType: 'trigger', service: 'Web apps', about: 'Venttup raises $3M seed round led by Rainmatter', signals: [{ text: 'Funding news: “Venttup raises $3M seed round led by Rainmatter”', source: 'Google News' }] };
const newsCtx = { ...ctx, lead: newsLead, facts: factsFor(newsLead), shape: 'event', proof };
const newsGood = {
  subject: 'congrats on the venttup seed round',
  ask: 'Congrats on the $3M seed round led by Rainmatter — a big step for Venttup.',
  proof: 'I rebuilt a D2C checkout last year and mobile conversion went up 18% in the first month.',
  approach: 'Teams that just raised often find the web app has to grow faster than the team does; I’d start by finding the slowest flow and fixing that first.',
  used: ['F1', 'R1'],
};
eq(checkFirstEmail(JSON.stringify(newsGood), newsCtx), null, 'a news email passes');
ok(/never asked/.test(checkFirstEmail(JSON.stringify({ ...newsGood, approach: 'You need a faster web app now that you are hiring, and I’d start with the slowest flow first.' }), newsCtx)), 'a news email saying "you need" is rejected');

console.log('\nPutting it together:');
const email = assemble(good, ctx);
ok(email.body.startsWith('Hi Ritika,'), 'greets them by first name');
ok(email.body.includes('\nhttps://prashuk.dev/work/checkout'), 'the case’s own link under the proof');
eq((email.body.match(/https?:\/\//g) || []).length, 1, 'exactly one link');
ok(email.body.includes(nextStep('asked', profile)), 'ends by offering a short plan');
ok(/Prashuk Jain\nFreelance React & Next.js developer$/.test(email.body), 'signed with name and one line about you');
const noProof = assemble({ ...good, proof: '' }, { ...ctx, proof: null });
ok(noProof.body.endsWith('Freelance React & Next.js developer · https://prashuk.dev'), 'no proof: the portfolio goes in the signature');
eq((noProof.body.match(/https?:\/\//g) || []).length, 1, 'still one link');
const words = (email.body.match(/\S+/g) || []).length;
ok(words >= 60 && words <= 170, `length is in range (${words} words)`);
ok(nextStep('asked', { availability: 'can start next week' }).startsWith('Can start next week. Want me'), 'availability goes before the question');
ok(/Worth me sending/.test(nextStep('event', {})), 'news leads get the softer question');

console.log('\nThe sequence:');
const step0 = STARTER.steps[0];
ok(step0.useLeadEmail, 'First contact’s first step sends each lead’s own email');
const sent = renderStep(step0, { ...lead, firstEmail: { ...email, shape: 'asked', state: 'written' } }, profile, {});
ok(sent.ok && sent.subject === 'your checkout rebuild before diwali', 'it sends the lead’s subject');
const blocked = renderStep(step0, lead, profile, {});
ok(!blocked.ok && /first email/.test(whyBlocked(blocked)), 'no email written yet: blocked, saying why');
ok(!renderStep(step0, { ...lead, firstEmail: { ...email, state: 'failed' } }, profile, {}).ok, 'a failed email is not sent');
const fu = renderStep({ ...STARTER.steps[1], subject: '' }, { ...lead, firstEmail: { subject: 'your checkout rebuild before diwali', shape: 'asked', caseTitle: 'D2C checkout rebuild', state: 'written' } }, profile, { senderName: 'Prashuk' });
ok(fu.ok && fu.body.includes('for your checkout rebuild before diwali') && fu.body.includes('Inventory dashboard'), 'the day-3 follow-up names their project and the next case');
const fuBare = renderStep({ ...STARTER.steps[1], subject: '' }, { ...lead, firstEmail: null }, { ...profile, cases: [], portfolioUrl: '' }, { senderName: 'Prashuk' });
ok(fuBare.ok && !/\n{3,}/.test(fuBare.body) && fuBare.body.includes('web apps for Brewbox'), 'nothing to add: the line goes, no gap, a sensible fallback');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
