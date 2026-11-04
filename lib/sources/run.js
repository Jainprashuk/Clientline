/**
 * Running a source: one SourceRun row per run, its work split into units (a
 * thread, a search) so each can be its own Inngest step later and no single
 * step comes near Vercel's 60-second limit. From Outreach's lib/sources/run.js.
 *
 * A source module exports:
 *   plan(ctx)          → { error, units[] }
 *   collect(unit, ctx) → { error, items[], read, credits?, stop? }
 * ctx = { userId, profile, keys, now, signal }
 *
 * One run per account per source at a time; a run older than STALE_MS is
 * treated as dead (a frozen serverless instance) and closed.
 */
const SourceRun = require('../../models/SourceRun');
const Profile = require('../../models/Profile');
const { loadKeys } = require('../searchKeys');
const { importItems } = require('../leads/import');
const { writeOpenersFor } = require('../leads/opener');
const hn = require('./hn');
const news = require('./news');
const webPosts = require('./webPosts');

const MODULES = { hn, news, 'web-post': webPosts };
const LABELS = { hn: 'Hacker News', news: 'Funding news', 'web-post': 'Client posts', paste: 'Pasted text' };

/** The run going on now for this account and source, closing a dead one first. */
async function activeRun(userId, source) {
  const run = await SourceRun.findOne({ userId, source, status: 'running' }).sort({ startedAt: -1 }).lean();
  if (!run) return null;
  if (Date.now() - new Date(run.startedAt).getTime() > SourceRun.STALE_MS) {
    await SourceRun.updateOne({ _id: run._id, status: 'running' }, { $set: { status: 'failed', finishedAt: new Date(), error: 'Stopped responding' } });
    return null;
  }
  return run;
}

/** A new run row, or null when one is already going. */
async function startRun(userId, source, trigger = 'manual') {
  if (await activeRun(userId, source)) return null;
  return SourceRun.create({ userId, source, trigger });
}

async function context(userId, now = new Date(), signal) {
  const [profile, keys] = await Promise.all([Profile.findOne({ userId }).lean(), loadKeys(userId)]);
  return { userId, profile: profile || {}, keys, now, signal };
}

/** Adds one import's counts and reasons to the run. */
async function record(runId, r, extra = {}) {
  const $inc = {
    read: r.read || 0, created: r.created || 0, held: r.held || 0, updated: r.updated || 0,
    repeats: r.repeats || 0, capped: r.capped || 0, dropped: r.dropped || 0, credits: extra.credits || 0,
    unitsDone: extra.unit ? 1 : 0,
  };
  // Map keys can't hold "." or "$".
  for (const [reason, n] of Object.entries(r.reasons || {})) $inc[`reasons.${reason.replace(/[.$]/g, '·')}`] = n;
  await SourceRun.updateOne({ _id: runId }, { $inc });
}

/** `error` with `worked` false is a failed run; with some unit having worked, it is kept as a note. */
async function finishRun(runId, { error = null, partial = false, worked = false } = {}) {
  const status = partial ? 'partial' : error && !worked ? 'failed' : 'done';
  await SourceRun.updateOne({ _id: runId }, {
    $set: { status, finishedAt: new Date(), error: error ? String(error).slice(0, 300) : null },
  });
  return SourceRun.findById(runId).lean();
}

/** Plans a run and stores how many units it has. */
async function planRun(run, ctx) {
  const p = await MODULES[run.source].plan(ctx);
  await SourceRun.updateOne({ _id: run._id }, { $set: { units: p.units.length } });
  return p;
}

/** One unit: collect, then judge/score/store. Returns { stop, error, leadIds }. */
async function runUnit(run, unit, ctx) {
  const c = await MODULES[run.source].collect(unit, ctx);
  // Web posts are where the text rules miss most; the AI settles client-or-not first.
  const aiRead = run.source === 'web-post';
  const r = c.items.length ? await importItems(ctx.userId, c.items, ctx.profile, { runId: run._id, now: ctx.now, aiRead, signal: ctx.signal }) : { reasons: {} };
  // `read` counts what the source returned, not only what was judged.
  r.read = c.read || 0;
  await record(run._id, r, { credits: c.credits || 0, unit: true });
  return { stop: !!c.stop, error: c.error || null, leadIds: r.leadIds || [] };
}

/**
 * The whole run in this process, stopping at `budgetMs` so a web request ends in
 * time; what is left over is picked up by the next run (status 'partial').
 */
async function runInline(userId, source, { trigger = 'manual', budgetMs = 45_000, now = new Date() } = {}) {
  const run = await startRun(userId, source, trigger);
  if (!run) return { busy: true, run: await activeRun(userId, source), leadIds: [] };
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs + 10_000);
  const leadIds = [];
  try {
    const ctx = await context(userId, now, controller.signal);
    const p = await planRun(run, ctx);
    if (p.error && !p.units.length) return { run: await finishRun(run._id, { error: p.error }), leadIds };
    let lastError = null;
    let partial = false;
    let worked = false;
    for (let i = 0; i < p.units.length; i++) {
      if (Date.now() - started > budgetMs) { partial = true; break; }
      const u = await runUnit(run, p.units[i], ctx);
      leadIds.push(...u.leadIds);
      if (u.error) lastError = u.error; else worked = true;
      if (u.stop) { partial = i < p.units.length - 1; break; }
    }
    // First lines for the best new leads, with whatever time is left.
    await writeOpenersFor(userId, leadIds, { max: 5, deadline: started + budgetMs, signal: controller.signal }).catch(() => {});
    return { run: await finishRun(run._id, { error: lastError, partial, worked }), leadIds };
  } catch (err) {
    return { run: await finishRun(run._id, { error: err.message }), leadIds };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { MODULES, LABELS, activeRun, startRun, context, planRun, runUnit, record, finishRun, runInline };
