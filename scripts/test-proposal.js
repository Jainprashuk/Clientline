#!/usr/bin/env node
/**
 * Proposals: what the draft checker lets through, gaps, the hash that records
 * what the client agreed to, expiry, and when a nudge is suggested. No network.
 *
 *   node scripts/test-proposal.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { readDraft, gapsIn } = require('../lib/proposals/draft');
const { contentHash, isExpired, termsLine, renderProposal } = require('../lib/proposals/page');
const { nudgeFor } = require('../routes/proposals');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };
const ok = (c, m) => eq(!!c, true, m);

const shown = `Checkout rebuild for Brewbox
We need our checkout rebuilt in Next.js before the Diwali sale. Mobile is where carts drop off. We also want Razorpay.
Timeline: live by 20 October
Past work: D2C checkout rebuild — mobile conversion up 18%
Rounds of changes included: 2
What I do: Web apps (React / Next.js)`;
const ctx = { minimum: 25000, currency: 'INR', shown };
const good = {
  title: 'Checkout rebuild for Brewbox',
  intro: 'You need the checkout rebuilt in Next.js before the Diwali sale, with mobile first because that is where carts drop off. I would ship it in stages so the sale is never at risk.',
  options: [
    { name: 'Essentials', price: 40000, weeks: 2, items: ['Mobile checkout rebuilt in Next.js', 'Razorpay payment step', 'Testing on mobile'] },
    { name: 'Standard', price: 65400, weeks: 3, items: ['Mobile checkout rebuilt in Next.js', 'Razorpay payment step', 'Testing on mobile', 'Desktop checkout too'] },
    { name: 'Complete', price: 90000, weeks: 4, items: ['Mobile checkout rebuilt in Next.js', 'Razorpay payment step', 'Testing on mobile', 'Desktop checkout too', '[address autofill?]'] },
  ],
  suggested: 1,
};
const read = (patch, c = ctx) => readDraft(JSON.stringify({ ...good, ...patch }), c);
const opts = (f) => good.options.map((o, i) => ({ ...o, ...f(o, i) }));

const r = read({});
ok(r.draft, 'a good draft passes');
eq(r.draft.options[1].price, 65000_00, 'prices round (₹1,000 steps) and are kept in paise');
eq(r.draft.options.map(o => o.suggested).join(), 'false,true,false', 'one option suggested');
ok(/MINIMUM/.test(read({ options: opts((o, i) => (i === 0 ? { price: 15000 } : {})) }).error || ''), 'an option under your minimum is rejected');
ok(/more than the one before/.test(read({ options: opts((o, i) => (i === 2 ? { price: 50000 } : {})) }).error || ''), 'prices that don’t rise are rejected');
ok(/fewer weeks/.test(read({ options: opts((o, i) => (i === 2 ? { weeks: 1 } : {})) }).error || ''), 'a bigger option in fewer weeks is rejected');
ok(/names something|number/.test(read({ options: opts((o, i) => (i === 2 ? { items: [...o.items, 'Shopify integration', 'Stripe integration'] } : {})) }).error || ''), 'an integration they never mentioned is rejected');
ok(read({ options: opts((o, i) => (i === 2 ? { items: [...o.items, '3 rounds of revisions', 'Payment integration'] } : {})) }).draft, 'an offer of "3 rounds of revisions" and a generic "Payment integration" are fine');
ok(/number/.test(read({ intro: 'You need the checkout rebuilt before the sale. I did this for 40 brands and it always ships in 10 days flat.' }).error || ''), 'an invented number is rejected');
ok(/sales words/.test(read({ intro: 'You need the checkout rebuilt before the Diwali sale. I’d love to deliver a seamless experience for your mobile users.' }).error || ''), 'sales words are rejected');
ok(/exactly 3/.test(readDraft(JSON.stringify({ ...good, options: good.options.slice(0, 2) }), ctx).error), 'two options are rejected');
eq(gapsIn({ ...good, options: r.draft.options }).join(), '[address autofill?]', 'gaps are found, to block sending');

const p = { title: 't', intro: 'i', currency: 'INR', options: r.draft.options, terms: { split: [30, 40, 30], rounds: 2, validDays: 14 }, proof: null };
const h = contentHash(p);
ok(h !== contentHash({ ...p, options: p.options.map((o, i) => (i ? o : { ...o, price: o.price + 100 })) }), 'the hash changes when a price changes');
eq(h, contentHash({ ...p, status: 'viewed', views: 9 }), 'and not when only its status or views change');
ok(isExpired({ status: 'sent', sentAt: new Date(Date.now() - 15 * 864e5), terms: { validDays: 14 } }), 'expires after its validity');
ok(!isExpired({ status: 'accepted', sentAt: new Date(Date.now() - 30 * 864e5), terms: { validDays: 14 } }), 'an accepted one never expires');
eq(termsLine({ split: [30, 40, 30], rounds: 2 }).split('.')[0], '30% to start, 40% at the halfway demo, 30% on delivery', 'terms read naturally');
eq(termsLine({ split: [50, 50], rounds: 1 }).split('.')[0], '50% to start, 50% on delivery', 'a two-part split too');

const sent = { status: 'sent', sentAt: new Date(Date.now() - 3 * 864e5), views: 0, terms: { validDays: 14 } };
ok(/Not opened/.test(nudgeFor(sent) || ''), 'unopened for 2+ days: nudge suggested');
ok(/Opened 2 times/.test(nudgeFor({ ...sent, status: 'viewed', views: 2, sentAt: new Date(Date.now() - 4 * 864e5) }) || ''), 'opened but quiet for 3+ days: nudge suggested');
eq(nudgeFor({ ...sent, nudgedAt: new Date() }), null, 'not right after a nudge');
eq(nudgeFor({ ...sent, sentAt: new Date() }), null, 'not on the day it was sent');

const html = renderProposal({ ...p, status: 'sent', sentAt: new Date() }, { from: { name: 'Prashuk <b>' } });
ok(html.includes('Prashuk &lt;b&gt;') && !html.includes('Prashuk <b>'), 'the page escapes what it shows');
ok(html.includes(`name="hash" value="${h}"`) && html.includes('type="radio"'), 'the accept form carries the hash and the options');
ok(!renderProposal({ ...p, status: 'accepted', acceptedBy: { name: 'Ritika', option: 1, at: new Date() } }, {}).includes('type="radio"'), 'an accepted proposal has no form');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
