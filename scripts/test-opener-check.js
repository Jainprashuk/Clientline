#!/usr/bin/env node
/**
 * The first-line validator: nothing invented gets through. No network, no database.
 *
 *   node scripts/test-opener-check.js
 */
// The module pulls in the models; nothing here touches a database.
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { checkOpener, factsFor, resultsFor } = require('../lib/leads/opener');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };

const lead = {
  name: 'Maasi', person: '', title: '', service: 'Web apps',
  signals: [{ text: 'Funding news: “Maasi raises ₹6 Cr pre-seed funding led by Better Capital”', source: 'Google News · ET Entrepreneur' }],
  about: 'Maasi raises ₹6 Cr pre-seed funding led by Better Capital — Maasi | Home cooked meals',
};
const profile = {
  name: 'Prashuk', headline: 'Freelance React and Node developer',
  services: [{ name: 'Web apps' }],
  cases: [{ title: 'Chai Point menu', result: 'Mobile score went from 34 to 92' }],
  proof: [{ who: 'Ritika, Brewbox', text: 'Delivered a week early.' }],
};
const facts = factsFor(lead);
const results = resultsFor(profile);
const ctx = { lead, facts, results, profile };
const J = (line, used = ['F1']) => JSON.stringify({ line, used });
const expect = (raw, wantOk, m) => {
  const reason = checkOpener(raw, ctx);
  if ((reason === null) === wantOk) ok(`${m}${reason ? ` (${reason})` : ''}`);
  else bad(`${m} — got ${reason === null ? 'accepted' : `rejected: ${reason}`}`);
};

console.log('Accepted:');
expect(J('Congrats on Maasi’s ₹6 Cr pre-seed round led by Better Capital — a funded kitchen brand usually needs its ordering web app to keep up fast.'), true, 'grounded in the funding fact');
expect(J('Congrats on the pre-seed round for Maasi. When I rebuilt the Chai Point menu, the mobile score went from 34 to 92, which is the kind of speed a meals app needs.', ['F1', 'R1']), true, 'cites a result with its exact numbers');

console.log('\nRejected:');
expect(J('Congrats on Maasi’s ₹10 Cr round led by Better Capital — a funded kitchen brand usually needs its ordering web app to keep up fast.'), false, 'invented number (10)');
expect(J('Congrats on Maasi’s pre-seed round — I doubled conversion for Swiggy last year, and a funded kitchen brand needs the same.', ['F1']), false, 'invented client claim with a number');
expect(J('Hi team, congrats on Maasi’s ₹6 Cr pre-seed round led by Better Capital — happy to help build your ordering web app.'), false, 'starts with a greeting');
expect(J('Congrats on the pre-seed — I am passionate about building cutting-edge web apps for food brands like yours, fast.'), false, 'boilerplate');
expect(J('Saw the news, congrats. A funded brand usually needs its web app to keep up, and that is the work I do every day.'), false, 'generic: never mentions this lead');
expect(J('Congrats on Maasi’s pre-seed round — see my work at https://example.com before you hire anyone for the web app.'), false, 'invented link');
expect(J('Congrats on Maasi’s pre-seed round. Ritika said “he saved our launch and our sanity” — that is what I bring to a web app.', ['F1', 'R2']), false, 'invented quote');
expect(J('Maasi raised money.'), false, 'too short');
expect(J('Congrats on Maasi’s ₹6 Cr pre-seed round led by Better Capital — a funded kitchen brand usually needs its ordering web app to keep up fast.', []), false, 'does not say which fact it used');
expect('Sure! Here is a line: Congrats on Maasi.', false, 'not JSON');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exitCode = 1;
