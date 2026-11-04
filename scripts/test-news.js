#!/usr/bin/env node
/**
 * Funding news: headline parsing and "is this the company's own website?". No network.
 *
 *   node scripts/test-news.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { companyFromHeadline, isFunding, hostMatches } = require('../lib/sources/news');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };

console.log('Headlines:');
eq(companyFromHeadline('Bengaluru-based AI startup Acme Labs raises $2M seed round'), 'Acme Labs', 'descriptors before the name are dropped');
eq(companyFromHeadline('Exclusive: Zepto bags Rs 500 crore from Motilal'), 'Zepto', '"Exclusive:" prefix');
eq(companyFromHeadline('AI Sales Startup Nooks Secures $500 Million in Funding'), 'Nooks', '"AI Sales Startup Nooks"');
eq(isFunding('India startup funding hits new low this week'), false, 'a funding round-up is not a company raising');
eq(isFunding('Acme lays off 200 after raising Series B'), false, 'layoffs are not a funding signal');

console.log('\nThe company’s own website (a news or data site names the company too):');
for (const [host, name, want] of [
  ['leadiq.com', 'Nooks', false], ['nooks.ai', 'Nooks', true],
  ['tavily.com', 'Dispatch Network', false], ['dispatchnetwork.co', 'Dispatch Network', true],
  ['getmaasi.com', 'Maasi', true], ['economictimes.com', 'Acme', false],
  ['flightdispatchnetwork.com', 'Dispatch Network', false], ['nookshq.com', 'Nooks', true],
]) eq(hostMatches(host, name), want, `${host} for ${name}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
