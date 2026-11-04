#!/usr/bin/env node
/**
 * Filling a sequence step for a lead. No network, no database.
 *
 *   node scripts/test-render.js
 */
const { renderStep, valuesFor, STARTER } = require('../lib/outreach/render');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };

const lead = { name: 'Brewbox', person: 'Ritika Sharma', opener: 'You posted that you need a React developer for your customer app.', service: 'Web apps (React / Next.js)' };
const profile = { name: 'Prashuk', headline: 'Freelance React and Node developer', services: [{ name: 'Web apps' }] };
const settings = { senderName: 'Prashuk Jain', bookingUrl: 'https://cal.com/prashuk' };

const r = renderStep(STARTER.steps[0], lead, profile, settings);
eq(r.ok, true, 'the starter step renders for a complete lead');
eq(r.subject, 'Quick idea for Brewbox', 'subject filled');
eq(r.body.startsWith('Hi Ritika,'), true, 'first name only');
eq(r.body.includes('{{'), false, 'no variable left over');

eq(valuesFor({ name: 'Acme', person: '' }).first, 'there', 'no person -> "there"');
eq(valuesFor({ person: 'HR Team' }).first, 'there', 'a title is not a first name');
eq(valuesFor({ service: 'Web apps (React / Next.js)' }).service, 'web apps', 'service reads naturally');
eq(valuesFor({ service: 'Shopify stores' }).service, 'Shopify stores', 'brand names keep their case');

const noOpener = renderStep(STARTER.steps[0], { ...lead, opener: '' }, profile, settings);
eq(noOpener.ok, false, 'a missing first line blocks the email');
eq(noOpener.missing.includes('opener'), true, 'and says which variable');
eq(renderStep({ subject: 'Hi', body: 'Book here: {{bookingLink}}' }, lead, profile, {}).ok, false, 'a missing booking link blocks it');
eq(renderStep({ subject: 'Hi', body: 'Hello {{frist}}' }, lead, profile, settings).ok, false, 'an unknown variable blocks it');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
