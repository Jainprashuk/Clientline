#!/usr/bin/env node
/**
 * Red flags on a deal: each rule fires with the words that set it off, and none
 * fires on an ordinary request. No network, no database.
 *
 *   node scripts/test-deal-flags.js
 */
const { flagsFor } = require('../lib/deals/flags');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };
const rules = (text, money) => flagsFor(text, money).map(f => f.rule).join(',');
const MIN = 25000_00; // ₹25,000 in paise

eq(rules('We need a React developer to rebuild our checkout before the Diwali sale. Budget ₹80,000.', { value: 80000_00, minimum: MIN }), '', 'an ordinary request raises nothing');
eq(rules('Need a landing page.', { value: 10000_00, minimum: MIN }), 'below-minimum', 'a budget under your minimum');
eq(rules('Need a landing page.', { value: 0, minimum: MIN }), '', 'no budget yet: nothing to compare');
eq(rules('Please do a small unpaid test task first so we can see your work.', {}), 'unpaid-test', 'an unpaid test task');
eq(rules('Can you do a free sample before we decide?', {}), 'unpaid-test', 'a free sample');
eq(rules('We will pay after launch once revenue comes in.', {}), 'pay-later', 'pay after launch');
eq(rules('This is equity-only for now.', {}), 'pay-later', 'equity only');
eq(rules('Great for your portfolio — it’s for the exposure.', {}), 'pay-later', 'for the exposure');
eq(rules('Need it urgently, by tomorrow.', { value: 30000_00, minimum: MIN }), 'urgent', 'a rush on a small budget');
eq(rules('Need it urgently, by tomorrow.', { value: 300000_00, minimum: MIN }), '', 'a rush on a good budget is fine');
eq(rules('Unlimited revisions included please.', {}), 'scope-creep', 'open-ended scope');
const f = flagsFor('Please do a small unpaid test task first.', {})[0];
eq(f.words, '“unpaid test task”', 'the flag shows the words that set it off');
eq(rules('Need it ASAP with a free test task.', { value: 5000_00, minimum: MIN }), 'below-minimum,unpaid-test,urgent', 'several at once, the budget first');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
