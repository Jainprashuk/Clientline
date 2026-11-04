#!/usr/bin/env node
/**
 * The full post text a first line is written from: the post out of a page's text,
 * and a funded company's own description. No network, no database.
 *
 *   node scripts/test-post-text.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { postText, resultsToItems } = require('../lib/sources/webPosts');
const { pageDescription } = require('../lib/sources/website');

let pass = 0, fail = 0;
const ok = (cond, m) => { if (cond) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

const snippet = 'We are looking for a freelance React developer to rebuild our checkout before the Diwali sale.';
const page = `Sign in · Join now\n\n[Home](https://x.com) ![logo](a.png)\n**Ritika Sharma** · Founder at Brewbox\n\n${snippet} The current one drops 30% of carts on mobile, and we need it live by 20 October. Budget is flexible for the right person. DM me or email ritika@brewbox.in.\n\nMore posts from other people\n` + 'filler '.repeat(400);

const full = postText(page, snippet);
ok(full.includes('drops 30% of carts on mobile'), 'keeps what the post says after the snippet');
ok(full.includes('20 October'), 'keeps the deadline');
ok(!full.includes('Sign in') && !full.includes('!['), 'leaves out the login wall and markdown');
ok(full.length <= 1500, 'at most 1,500 characters');
ok(postText('A page about something else entirely, nothing in common.', snippet) === '', 'a page without the snippet gives nothing');
ok(postText('', snippet) === '', 'no page text gives nothing');
ok(postText(page, 'too short') === '', 'a very short snippet gives nothing');

const [item] = resultsToItems([{ title: 'Ritika Sharma on LinkedIn', url: 'https://www.linkedin.com/posts/ritika_abc', snippet, page }]);
ok(item.about.includes('drops 30% of carts'), 'the lead keeps the full post as what they wrote');
ok(!/search snippet/.test(item.where), 'not labelled a search snippet when the post was read');
const [bare] = resultsToItems([{ title: 'x', url: 'https://reddit.com/r/a/1', snippet }]);
ok(bare.about === snippet && /search snippet/.test(bare.where), 'without page text: the snippet, labelled so');

ok(pageDescription('<meta name="description" content="Brewbox makes cold brew coffee for Indian offices.">') === 'Brewbox makes cold brew coffee for Indian offices.', 'meta description');
ok(pageDescription('<meta content="Payments infrastructure for small Indian shops." property="og:description">') === 'Payments infrastructure for small Indian shops.', 'og:description, content first');
ok(pageDescription('<title>Acme</title>') === '', 'no description gives nothing');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
