#!/usr/bin/env node
/**
 * Reading replies and bounces: the pure parts. No network, no database.
 *
 *   node scripts/test-mailbox-parse.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { parseBounces, refsOf } = require('../lib/mailbox/scan');
const { byRules, stripQuoted, returnDate } = require('../lib/inbox/classify');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };

console.log('Bounces:');
const dsn = `Content-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; ritika@brewbox.in\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.\r\n   Please try double-checking the recipient's email address.\r\n`;
const b = parseBounces(dsn);
eq(b.length, 1, 'a DSN gives one bounced address');
eq(b[0] && b[0].email, 'ritika@brewbox.in', 'the address');
eq(/does not exist/.test(b[0] && b[0].reason), true, 'the reason, folded onto one line');
eq(parseBounces('Final-Recipient: rfc822; a@b.com\r\nStatus: 4.4.1\r\n').length, 0, 'a 4.x.x delay is not a bounce');
eq(parseBounces("Your message wasn't delivered to sam@fitloop.in because the address couldn't be found.\n")[0].email, 'sam@fitloop.in', "Gmail's plain-text notice");

console.log('\nThreading:');
eq(refsOf({ inReplyTo: '<a@x>', references: ['<a@x>', '<b@x>'] }).join(','), 'a@x,a@x,b@x', 'In-Reply-To and References, brackets removed');
eq(refsOf({ references: '<c@x>' }).join(','), 'c@x', 'a single References string');

console.log('\nRules:');
eq(byRules({ subject: 'Automatic reply: Quick idea for Acme', text: 'I am out of the office until 12 Jan.' }).category, 'auto', 'out-of-office subject');
eq(byRules({ subject: 'Re: Quick idea', text: 'Hi', headers: { 'auto-submitted': 'auto-replied' } }).category, 'auto', 'Auto-Submitted header');
eq(byRules({ subject: 'Re: Quick idea', text: 'Please remove me from your list.' }).stop, true, '"remove me" stops and blocks');
eq(byRules({ subject: 'Re: Quick idea', text: 'Thanks, but not interested.' }).category, 'no', 'a short no');
eq(byRules({ subject: 'Re: Quick idea', text: 'Sounds good — can you send a quote for the app?' }), null, 'a real reply goes to the AI');
eq(byRules({ subject: 'Re: idea', text: 'Not interested right now but this is a long reply that goes on and explains that next quarter we might look at rebuilding the whole app with a proper team, so please do follow up in March with a proposal and pricing for the work.' }), null, 'a long "not interested right now" is not a flat no');

console.log('\nOut-of-office return dates:');
const now = new Date('2026-11-04T10:00:00Z');
const d1 = returnDate("I'm back on 12 November", now);
eq(d1 && d1.getDate(), 12, '"back on 12 November"');
const d2 = returnDate('Returning January 5th', now);
eq(d2 && d2.getFullYear(), 2027, '"Returning January 5th" said in November is next year');
eq(returnDate('I will reply soon', now), null, 'no date');

console.log('\nQuoted text:');
eq(stripQuoted('Yes please, send a quote.\n\nOn Tue, 4 Nov 2026 at 10:00, Prashuk <p@x.com> wrote:\n> Hi Ritika'), 'Yes please, send a quote.', 'the quoted email is cut');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
