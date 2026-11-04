/**
 * Public: /u/<token>, the unsubscribe link in every outreach email. No sign-in —
 * the token is the proof (lib/outreach/unsubscribe.js).
 *
 * GET shows a confirmation button rather than unsubscribing, because mail
 * scanners open links on their own. POST does it, and is also the one-click
 * target that Gmail's own "Unsubscribe" button calls (List-Unsubscribe-Post).
 * Unsubscribing blocks the address for that sender and stops every sequence to it.
 */
const express = require('express');
const Blocklist = require('../models/Blocklist');
const Enrollment = require('../models/Enrollment');
const { readToken } = require('../lib/outreach/unsubscribe');
const { escapeHtml } = require('../lib/emailLayout');

const router = express.Router();

const page = (title, body, form = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;background:#f3f4f8;color:#1a1c26;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border:1px solid #e3e5ec;border-radius:14px;padding:28px 26px;max-width:420px;margin:16px}
h1{font-size:19px;margin:0 0 8px}p{margin:0 0 16px;color:#4a4f60}button{font:inherit;font-weight:600;background:#635bff;color:#fff;border:0;border-radius:9px;padding:10px 16px;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#0a0b0f;color:#e8e9ef}main{background:#15161d;border-color:#2a2c36}p{color:#a2a6b5}}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${body}</p>${form}</main></body></html>`;

router.get('/:token', (req, res) => {
  const t = readToken(req.params.token);
  res.set('Cache-Control', 'no-store');
  if (!t) return res.status(400).send(page('This link isn’t valid', 'It may have been copied incompletely.'));
  res.send(page('Stop these emails?', `You won’t get any more emails from this sender at <b>${escapeHtml(t.email)}</b>.`,
    `<form method="post"><button type="submit">Unsubscribe</button></form>`));
});

router.post('/:token', async (req, res) => {
  const t = readToken(req.params.token);
  res.set('Cache-Control', 'no-store');
  if (!t) return res.status(400).send(page('This link isn’t valid', 'It may have been copied incompletely.'));
  try {
    await Blocklist.blockEmail(t.userId, t.email, 'unsubscribed');
    await Enrollment.updateMany({ userId: t.userId, email: t.email, status: { $in: ['active', 'paused'] } },
      { $set: { status: 'stopped', stopReason: 'unsubscribed', sendingUntil: null } });
    res.send(page('You’re unsubscribed', 'You won’t get any more emails from this sender. Sorry for the bother.'));
  } catch (err) {
    console.error(`[unsubscribe] ${err.message}`);
    res.status(500).send(page('Something went wrong', 'Please try the link again in a minute.'));
  }
});

module.exports = router;
