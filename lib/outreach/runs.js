/**
 * Sending in the background: a SendRun per "send what's due", worked through in
 * small batches by Inngest (lib/outreach/inngest.js) so it carries on after the
 * page is closed and each step stays inside Vercel's 60 s.
 *
 * When Inngest can't be reached — local development without its dev server —
 * the same loop runs inside this process instead (never on Vercel, where a
 * request's process is frozen once it answers).
 */
const SendRun = require('../../models/SendRun');
const { inngest } = require('../../inngest');
const { sendDue, dueSummary } = require('./send');
const { checkMailbox } = require('../mailbox/scan');

const BATCH = 5;
const GAP_MS = 8_000;   // between batches: a little spacing, as a person would send
const MAX_BATCHES = 60;

/** The run going on now, closing one that stopped answering. */
async function activeRun(userId) {
  const r = await SendRun.findOne({ userId, status: { $in: ['queued', 'running'] } }).sort({ startedAt: -1 }).lean();
  if (r && Date.now() - new Date(r.startedAt).getTime() > SendRun.STALE_MS) {
    await SendRun.updateOne({ _id: r._id }, { $set: { status: 'failed', finishedAt: new Date(), stoppedBy: 'Stopped responding' } });
    return null;
  }
  return r;
}

const usingInngest = () => !!(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV);

/**
 * Starts sending what's due for one account. Returns { run } or { busy: run } when
 * one is already going, or { nothing: true } when nothing is due.
 */
async function startSendRun(userId, { only = null, trigger = 'manual' } = {}) {
  const busy = await activeRun(userId);
  if (busy) return { busy };
  const due = await dueSummary(userId);
  const total = only ? only.length : due.first + due.followUps;
  if (!total) return { nothing: true };
  const run = await SendRun.create({ userId, trigger, only: only || undefined, total });
  const runId = String(run._id);
  let dispatched = false;
  if (usingInngest()) {
    try { await inngest.send({ name: 'outreach/send.run', data: { runId, userId: String(userId) } }); dispatched = true; }
    catch (err) { console.error(`[outreach] Inngest unavailable, sending in-process: ${err.message}`); }
  }
  if (!dispatched) {
    if (process.env.VERCEL) {
      await SendRun.updateOne({ _id: run._id }, { $set: { status: 'failed', finishedAt: new Date(), stoppedBy: 'Background sending is not set up (Inngest).' } });
      return { run: await SendRun.findById(run._id).lean() };
    }
    // Local: the same loop, in this process.
    runInProcess(runId).catch(err => console.error(`[outreach] send run failed: ${err.message}`));
  }
  return { run: run.toObject() };
}

/**
 * One batch of a run. Returns { finished }. Shared by Inngest (one step per batch)
 * and the in-process loop.
 */
async function runBatch(runId) {
  const run = await SendRun.findById(runId).lean();
  if (!run || ['done', 'stopped', 'failed'].includes(run.status)) return { finished: true };
  if (run.stopRequested) {
    await SendRun.updateOne({ _id: run._id }, { $set: { status: 'stopped', finishedAt: new Date() } });
    return { finished: true };
  }
  if (run.status === 'queued') {
    await SendRun.updateOne({ _id: run._id }, { $set: { status: 'running' } });
    // Replies first, so nobody who answered gets a follow-up.
    await checkMailbox(run.userId, { minIntervalMs: 2 * 60 * 1000, budgetMs: 20_000 }).catch(() => {});
  }
  const r = await sendDue(run.userId, { max: BATCH, budgetMs: 40_000, only: run.only && run.only.length ? run.only : null });
  const update = { $inc: { sent: r.sent }, $push: { skipped: { $each: r.skipped.slice(0, 20), $slice: -50 } } };
  if (r.last) update.$set = { last: r.last };
  const finished = !!r.stoppedBy || !r.more || r.sent === 0;
  if (finished) {
    update.$set = { ...(update.$set || {}), status: r.stoppedBy && !(run.sent + r.sent) ? 'failed' : 'done', finishedAt: new Date(), stoppedBy: r.stoppedBy || null };
  }
  await SendRun.updateOne({ _id: run._id }, update);
  return { finished };
}

async function runInProcess(runId) {
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { finished } = await runBatch(runId);
    if (finished) return;
    await new Promise(res => setTimeout(res, GAP_MS));
  }
}

async function stopRun(userId, runId) {
  const r = await SendRun.updateOne({ _id: runId, userId, status: { $in: ['queued', 'running'] } }, { $set: { stopRequested: true } });
  return r.modifiedCount === 1;
}

/** The run to show in the floating panel: the active one, or one that just finished. */
async function runForPanel(userId) {
  const active = await activeRun(userId);
  if (active) return active;
  return SendRun.findOne({ userId, finishedAt: { $gt: new Date(Date.now() - 2 * 60 * 1000) } }).sort({ finishedAt: -1 }).lean();
}

module.exports = { startSendRun, runBatch, runInProcess, stopRun, activeRun, runForPanel, usingInngest, BATCH, GAP_MS, MAX_BATCHES };
