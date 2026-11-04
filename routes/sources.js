/**
 * Finding leads: what each source needs, its last runs, "Find leads" for one
 * source, and the two-step paste (preview, then import). Every call is scoped
 * to req.userId.
 *
 * A source runs only for a complete profile: without services and a minimum
 * there is nothing to judge a lead against, and every item would be dropped.
 */
const express = require('express');
const Profile = require('../models/Profile');
const SourceRun = require('../models/SourceRun');
const { loadKeys } = require('../lib/searchKeys');
const { runInline, startRun, finishRun, record, LABELS } = require('../lib/sources/run');
const { pasteToItems, MAX_TEXT } = require('../lib/sources/paste');
const { importItems } = require('../lib/leads/import');

const router = express.Router();
const RUNNABLE = ['hn', 'news', 'web-post'];

async function profileOrError(userId) {
  const profile = await Profile.findOne({ userId }).lean();
  const missing = Profile.missingFor(profile);
  return { profile, missing };
}

const runView = (r) => r && ({
  id: String(r._id), source: r.source, label: LABELS[r.source], trigger: r.trigger, status: r.status,
  startedAt: r.startedAt, finishedAt: r.finishedAt, units: r.units, unitsDone: r.unitsDone,
  read: r.read, created: r.created, held: r.held, updated: r.updated, repeats: r.repeats, capped: r.capped, dropped: r.dropped,
  credits: r.credits, error: r.error,
  reasons: Object.entries(r.reasons instanceof Map ? Object.fromEntries(r.reasons) : (r.reasons || {}))
    .sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
});

/** Per source: is it on, what does it still need, and how did its last run go. */
router.get('/', async (req, res) => {
  try {
    const [{ profile, missing }, keys] = await Promise.all([profileOrError(req.userId), loadKeys(req.userId)]);
    const last = await Promise.all([...RUNNABLE, 'paste'].map(s => SourceRun.findOne({ userId: req.userId, source: s }).sort({ startedAt: -1 }).lean()));
    const hasSearch = !!(keys.tavily || keys.serpapi);
    const on = (profile && profile.sources) || {};
    const needs = (s) => {
      if (missing.length) return `Finish My profile: add ${missing.join(', ')}`;
      if (s === 'web-post' && !hasSearch) return 'Add a free Tavily key in Free connections';
      return null;
    };
    res.json({
      profileComplete: missing.length === 0,
      missing,
      sources: [...RUNNABLE, 'paste'].map((s, i) => ({
        source: s,
        label: LABELS[s],
        enabled: s === 'paste' ? true : on[s === 'web-post' ? 'web' : s] !== false,
        needs: s === 'paste' ? (missing.length ? needs(s) : null) : needs(s),
        lastRun: runView(last[i]),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const runs = await SourceRun.find({ userId: req.userId }).sort({ startedAt: -1 }).limit(Math.min(50, Number(req.query.limit) || 20)).lean();
    res.json({ runs: runs.map(runView) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Find leads now from one source. Runs here, within a request-sized time budget. */
router.post('/run', async (req, res) => {
  const source = req.body && req.body.source;
  if (!RUNNABLE.includes(source)) return res.status(400).json({ error: 'Unknown source' });
  try {
    const { missing } = await profileOrError(req.userId);
    if (missing.length) return res.status(400).json({ error: `Finish My profile first: add ${missing.join(', ')}.`, code: 'PROFILE_INCOMPLETE' });
    const r = await runInline(req.userId, source, { trigger: 'manual' });
    if (r.busy) return res.status(409).json({ error: `${LABELS[source]} is already running.`, run: runView(r.run) });
    res.json({ run: runView(r.run) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function pastedText(req) {
  const text = req.body && typeof req.body.text === 'string' ? req.body.text : '';
  if (!text.trim()) return { error: 'Paste a chat export or a post first.' };
  if (text.length > MAX_TEXT) return { error: `That is more than ${Math.round(MAX_TEXT / 1024)} KB — paste a smaller part.` };
  return { text };
}

/** What a paste would give, judged and scored, without saving anything. */
router.post('/paste/preview', async (req, res) => {
  const { text, error } = pastedText(req);
  if (error) return res.status(400).json({ error });
  try {
    const { missing, profile } = await profileOrError(req.userId);
    if (missing.length) return res.status(400).json({ error: `Finish My profile first: add ${missing.join(', ')}.`, code: 'PROFILE_INCOMPLETE' });
    const { items, messages } = pasteToItems(text);
    const r = await importItems(req.userId, items, profile, { dryRun: true });
    res.json({ messages, considered: items.length, kept: r.kept, held: r.held, dropped: r.dropped, reasons: r.reasons, preview: r.preview.slice(0, 200) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Save what the paste gives. Recorded as a run like any source. */
router.post('/paste/import', async (req, res) => {
  const { text, error } = pastedText(req);
  if (error) return res.status(400).json({ error });
  try {
    const { missing, profile } = await profileOrError(req.userId);
    if (missing.length) return res.status(400).json({ error: `Finish My profile first: add ${missing.join(', ')}.`, code: 'PROFILE_INCOMPLETE' });
    const run = await startRun(req.userId, 'paste', 'manual');
    if (!run) return res.status(409).json({ error: 'A paste is already being imported.' });
    await SourceRun.updateOne({ _id: run._id }, { $set: { units: 1 } });
    try {
      const { items, messages } = pasteToItems(text);
      const r = await importItems(req.userId, items, profile, { runId: run._id });
      r.read = messages;
      await record(run._id, r, { unit: true });
      res.json({ run: runView(await finishRun(run._id, { worked: true })) });
    } catch (err) {
      await finishRun(run._id, { error: err.message });
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
