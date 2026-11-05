#!/usr/bin/env node
/**
 * Projects: the checklist from the accepted option, health against the target
 * date, and the progress update (only what's ticked off). No network.
 *
 *   node scripts/test-project.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { itemsOf, healthOf, suggestedChecklist } = require('../lib/projects/project');
const { updateText } = require('../lib/projects/update');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };
const DAY = 864e5;

const proposal = { options: [
  { name: 'Essentials', items: ['Customer sign-up', 'Demo slot booking'] },
  { name: 'Standard', items: ['All Essentials features', 'Admin booking list'] },
  { name: 'Complete', items: ['All Standard features', 'Post-launch support', 'Admin booking list'] },
] };
eq(itemsOf(proposal, 2).join(' | '), 'Customer sign-up | Demo slot booking | Admin booking list | Post-launch support', '"All Standard features" expands down the options, no repeats');
eq(itemsOf(proposal, 0).join(' | '), 'Customer sign-up | Demo slot booking', 'Essentials as is');

const accepted = { ...proposal, acceptedBy: { option: 2 }, options: proposal.options.map((o, i) => (i === 2 ? { ...o, items: [...o.items, 'Two rounds of revisions'] } : o)) };
const sug = suggestedChecklist({ project: {} }, accepted);
eq(sug.filter(x => x.keep).map(x => x.text).join(' | '), 'Customer sign-up | Demo slot booking | Admin booking list', 'suggested: real steps ticked');
eq(sug.filter(x => !x.keep).map(x => x.text).join(' | '), 'Post-launch support | Two rounds of revisions', 'suggested: terms unticked, for you to decide');
eq(suggestedChecklist({ project: { checklistReviewed: true } }, accepted), null, 'nothing suggested once you’ve reviewed it');
eq(suggestedChecklist({ project: { tasks: [{ text: 'x' }] } }, accepted), null, 'nothing suggested when there are tasks already');
eq(suggestedChecklist({ project: {} }, null), null, 'no accepted proposal: nothing to suggest');

const start = Date.now() - 10 * DAY;
const deal = (tasks, targetIn, stage = 'progress') => ({ stage, project: { startedAt: new Date(start), targetAt: new Date(Date.now() + targetIn * DAY), tasks } });
const t = (n, done) => Array.from({ length: n }, (_, i) => ({ text: `T${i}`, done: i < done }));
eq(healthOf(deal(t(4, 2), 10)).state, 'ok', 'half done, halfway: on track');
eq(healthOf(deal(t(10, 0), 2)).state, 'behind', 'nothing done near the end: behind');
eq(healthOf(deal(t(4, 4), 2)).state, 'soon', 'all done, due in 2 days: due soon');
eq(healthOf(deal(t(4, 3), -3)).label, '3 days late', 'past the target: late');
eq(healthOf(deal(t(4, 1), -3, 'delivered')).state, 'delivered', 'delivered is never late');
eq(healthOf(deal(t(4, 1), 10)).pct, 25, 'percent done');

const p = { name: 'Checkout rebuild', project: { targetAt: new Date('2026-11-26'), tasks: [{ text: 'Sign-up', done: true, doneAt: new Date() }, { text: 'Payments', done: false }], updates: [] } };
const text = updateText({ deal: p, health: { state: 'ok' }, payments: [] });
eq(/Done so far:\n• Sign-up/.test(text) && /Next:\n• Payments/.test(text) && /On course for 26 November/.test(text), true, 'update: done, next, target');
const after = updateText({ deal: { ...p, project: { ...p.project, updates: [{ at: new Date(Date.now() + 1000) }] } }, health: { state: 'ok' }, payments: [] });
eq(/Done/.test(after), false, 'only what was ticked since the last update');
eq(/\[When you now expect to finish\]/.test(updateText({ deal: p, health: { state: 'late' }, payments: [] })), true, 'late: honest, with a gap for your new date');
eq(updateText({ deal: { name: 'x', project: { tasks: [] } }, health: { state: 'none' }, payments: [] }), null, 'no checklist: no update');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
