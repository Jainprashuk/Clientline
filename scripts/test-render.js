#!/usr/bin/env node
/**
 * Filling a sequence step for a lead. No network, no database.
 *
 *   node scripts/test-render.js
 */
const { renderStep, valuesFor } = require('../lib/outreach/render');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };

const lead = { name: 'Brewbox', person: 'Ritika Sharma', opener: 'You posted that you need a React developer for your customer app.', service: 'Web apps (React / Next.js)' };
const profile = { name: 'Prashuk', headline: 'Freelance React and Node developer', services: [{ name: 'Web apps' }] };
const settings = { senderName: 'Prashuk Jain', bookingUrl: 'https://cal.com/prashuk' };

// A template built around the first line — how your own sequences can still be written
// (the ready-made one now sends each lead's whole email; see test-first-email.js).
const TEMPLATE = { subject: 'Quick idea for {{company}}', body: 'Hi {{first}},\n\n{{opener}}\n\nI’m {{myName}} — {{myHeadline}}.\n\n{{caseLine}}\n\n{{myName}}' };
const r = renderStep(TEMPLATE, lead, profile, settings);
eq(r.ok, true, 'a template step renders for a complete lead');
eq(r.subject, 'Quick idea for Brewbox', 'subject filled');
eq(r.body.startsWith('Hi Ritika,'), true, 'first name only');
eq(r.body.includes('{{'), false, 'no variable left over');
eq(/\n{3,}/.test(r.body), false, 'an empty optional line leaves no gap');

eq(valuesFor({ name: 'Acme', person: '' }).first, 'there', 'no person -> "there"');
eq(valuesFor({ person: 'HR Team' }).first, 'there', 'a title is not a first name');
eq(valuesFor({ service: 'Web apps (React / Next.js)' }).service, 'web apps', 'service reads naturally');
eq(valuesFor({ service: 'Shopify stores' }).service, 'Shopify stores', 'brand names keep their case');

const noOpener = renderStep(TEMPLATE, { ...lead, opener: '' }, profile, settings);
eq(noOpener.ok, false, 'a missing first line blocks the email');
eq(noOpener.missing.includes('opener'), true, 'and says which variable');
eq(renderStep({ subject: 'Hi', body: 'Book here: {{bookingLink}}' }, lead, profile, {}).ok, false, 'a missing booking link blocks it');
eq(renderStep({ subject: 'Hi', body: 'Hello {{frist}}' }, lead, profile, settings).ok, false, 'an unknown variable blocks it');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
