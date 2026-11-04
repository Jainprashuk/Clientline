#!/usr/bin/env node
/**
 * Unsubscribe tokens: they round-trip, and a changed one is refused. No network.
 *
 *   node scripts/test-unsubscribe.js
 */
process.env.CREDENTIAL_KEY = process.env.CREDENTIAL_KEY || Buffer.alloc(32, 7).toString('base64');
const { makeToken, readToken } = require('../lib/outreach/unsubscribe');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };

const user = '6aad6787edf2628440821a04'; const lead = '6aeb031884995d439bbee51b';
const t = makeToken(user, lead, 'Ritika@Brewbox.in');
const r = readToken(t);
eq(r && r.userId, user, 'user round-trips');
eq(r && r.leadId, lead, 'lead round-trips');
eq(r && r.email, 'ritika@brewbox.in', 'email round-trips, lowercased');
const [payload, sig] = t.split('.');
const other = Buffer.from(`${user}.${lead}.someone@else.com`).toString('base64url');
eq(readToken(`${other}.${sig}`), null, 'a different address with the old signature is refused');
eq(readToken(`${payload}.${sig.slice(0, -1)}A`), null, 'a changed signature is refused');
eq(readToken('nonsense'), null, 'garbage is refused');
process.env.UNSUBSCRIBE_SECRET = 'another key';
eq(readToken(t), null, 'a token signed with another key is refused');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
