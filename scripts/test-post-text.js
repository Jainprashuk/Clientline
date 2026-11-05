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
const [bare] = resultsToItems([{ title: 'x', url: 'https://www.reddit.com/r/a/comments/1abc/need_dev', snippet }]);
ok(bare.about === snippet && /search snippet/.test(bare.where), 'without page text: the snippet, labelled so');

// Only a page that is someone's post; the rest of a 5 Nov 2026 run on prod was noise.
const kept = (url, title = 'x') => resultsToItems([{ title, url, snippet }]).length === 1;
ok(kept('https://www.linkedin.com/posts/katiewallaceco_looking-for-a-recommendation-activity-7523886251326799872-hMLR'), 'a LinkedIn post is kept');
ok(kept('https://www.reddit.com/r/jobsinjapan/comments/1xj67b0/wanted_it_freelancerscontractors_for_ai'), 'a Reddit thread is kept');
ok(kept('https://x.com/someone/status/2115819996630671437'), 'a post on X is kept');
for (const url of [
  'https://www.linkedin.com/pulse/hire-website-developer-find-best-expert-your-business-dh6pc',
  'https://www.ziprecruiter.com/Jobs/Contract-React-Js-Remote/-in-Houston,TX',
  'https://jobright.ai/jobs/react-developer--nyc-hybrid',
  'https://topdevcrew.com/hire/nextjs-developers',
  'https://khaledjamal.dev/blog/hiring-nextjs-developer',
  'https://www.linkedin.com/jobs/view/123',
  'https://www.reddit.com/r/Contractor/',
]) ok(!kept(url), `not a post, set aside: ${url.replace(/^https:\/\/(www\.)?/, '').slice(0, 45)}`);
ok(!kept('https://www.reddit.com/r/hiredev/comments/1xmmgbo/for_hire_web_developer', '[FOR HIRE] Web Developer | Business Websites'), '"[FOR HIRE]" in the title is set aside');
ok(!kept('https://www.reddit.com/r/freelancer_hire/comments/1xkvo61/for_hire_web_developer', '[For Hire] Web Developer : r/freelancer_hire'), '"[For Hire]" in the title is set aside');

const { buildQueries, TEMPLATES } = require('../lib/sources/webPosts');
ok(!TEMPLATES.some(t => /contractor/i.test(t)), 'no "contractor" query (construction trades)');
ok(buildQueries({ services: [{ keywords: ['next.js'] }] }, 50).some(q => q.includes('"recommendation for a" next.js')), 'asks the way a client does: "recommendation for a"');

const { dedupeKeyFor } = require('../lib/leads/import');
const hn = (id) => dedupeKeyFor({ postUrl: `https://news.ycombinator.com/item?id=${id}` });
ok(hn('50342576') !== hn('50342697'), 'two HN posts are two leads');
ok(hn('50342576') === 'u:https://news.ycombinator.com/item?id=50342576', 'the HN post id is part of the key');
ok(dedupeKeyFor({ postUrl: 'https://www.linkedin.com/posts/a_b-activity-1?utm_source=share' }) === dedupeKeyFor({ postUrl: 'https://www.linkedin.com/posts/a_b-activity-1/' }), 'tracking parameters and a trailing slash still ignored');

const { aiFor } = require('../lib/leads/readPosts');
const { judge } = require('../lib/leads/gates');
const prof = { services: [{ name: 'Web apps', keywords: ['next.js', 'web developer'] }], locations: ['india', 'us'] };
const post = (text, writer) => ({ source: 'web-post', sourceType: 'asked', text, ai: writer && aiFor(writer), postedAt: new Date(), emails: [], signals: [{ text: 'posted', source: 'test', url: null }] });
const katie = 'Katie Wallace\'s Post Looking for a recommendation for a web developer that has worked with Next.js, Vercel and Sanity. Freelancer or small agency, DFW based bonus but not required.';
ok(judge(post(katie), prof).verdict !== 'drop', 'Katie\'s post is a lead by the rules alone (no AI key)');
ok(judge(post(katie, 'client'), prof).verdict !== 'drop', 'Katie\'s post is a lead when the AI says client');
ok(/job board/.test(judge(post('Contract React Js Remote Jobs in Houston. Browse 17 jobs, freelance web developer', 'job'), prof).reason), 'the AI saying job board drops it, and says so');
ok(/article/.test(judge(post('Hiring a Next.js developer: looking for a freelance web developer? Here is how I work', 'article'), prof).reason), 'the AI saying article drops it, and says so');

ok(pageDescription('<meta name="description" content="Brewbox makes cold brew coffee for Indian offices.">') === 'Brewbox makes cold brew coffee for Indian offices.', 'meta description');
ok(pageDescription('<meta content="Payments infrastructure for small Indian shops." property="og:description">') === 'Payments infrastructure for small Indian shops.', 'og:description, content first');
ok(pageDescription('<title>Acme</title>') === '', 'no description gives nothing');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
