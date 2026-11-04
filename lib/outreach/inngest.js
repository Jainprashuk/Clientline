// Inngest functions for Outreach. Same shape as Outreach-the-app's sources: the
// per-user function runs one at a time per user; a cron fans out one event per user.
//
// Prod needs an Inngest sync after deploying these (Inngest dashboard → Apps →
// clientline → Resync, URL https://<host>/api/inngest).

const mongoose = require('mongoose');
const { inngest } = require('../../inngest');
const db = require('../../db');
const SentEmail = require('../../models/SentEmail');
const { runBatch, MAX_BATCHES, GAP_MS } = require('./runs');
const { checkMailbox } = require('../mailbox/scan');

const ensureDb = async () => {
  if (mongoose.connection.readyState !== 1) await db.connect();
};

// "Send due emails": one step per batch of a few emails, so each stays well inside
// Vercel's 60 s and a retry repeats one batch at most (sending claims each email
// first, so a repeat can't send twice).
const outreachSendRun = inngest.createFunction(
  {
    id: 'outreach-send-run',
    retries: 2,
    concurrency: { limit: 1, key: 'event.data.userId' },
    triggers: [{ event: 'outreach/send.run' }],
  },
  async ({ event, step }) => {
    const { runId } = event.data;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { finished } = await step.run(`batch-${i}`, async () => { await ensureDb(); return runBatch(runId); });
      if (finished) return { batches: i + 1 };
      await step.sleep(`gap-${i}`, `${Math.round(GAP_MS / 1000)}s`);
    }
    return { batches: MAX_BATCHES };
  },
);

// Replies and bounces, every hour, for everyone who has emailed someone in the last
// 30 days — so sequences stop on a reply even when nobody opens the app.
const outreachMailboxHourly = inngest.createFunction(
  { id: 'outreach-mailbox-hourly', triggers: [{ cron: 'TZ=Asia/Kolkata 15 * * * *' }] },
  async ({ step }) => {
    const users = await step.run('find-users', async () => {
      await ensureDb();
      const ids = await SentEmail.distinct('userId', { sentAt: { $gt: new Date(Date.now() - 30 * 86400000) } });
      return ids.map(String);
    });
    if (users.length) await step.sendEvent('fan-out', users.map(userId => ({ name: 'outreach/mailbox.check', data: { userId } })));
    return { users: users.length };
  },
);

const outreachMailboxCheck = inngest.createFunction(
  {
    id: 'outreach-mailbox-check',
    retries: 1,
    concurrency: { limit: 1, key: 'event.data.userId' },
    triggers: [{ event: 'outreach/mailbox.check' }],
  },
  async ({ event, step }) => step.run('check', async () => {
    await ensureDb();
    const r = await checkMailbox(event.data.userId, { minIntervalMs: 10 * 60 * 1000, budgetMs: 40_000 });
    return { ok: r.ok !== false, error: r.error || null };
  }),
);

module.exports = { outreachSendRun, outreachMailboxHourly, outreachMailboxCheck };
