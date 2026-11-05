/**
 * Emails to you about your proposals: first opened, opened again after a quiet
 * spell, changes asked, accepted. Through lib/ownerAlert.js (never throws).
 */
const Deal = require('../../models/Deal');
const { alertOwner } = require('../ownerAlert');
const { afterAccept } = require('./accept');

const REOPEN_QUIET_MS = 3 * 86400000;
const who = (deal) => (deal && (deal.person || deal.client || deal.email)) || 'Your client';
const path = (p) => `/proposals?p=${p._id}`;

/** Called on every open of the page, with the proposal as it was before this open. */
async function onOpened(p) {
  const deal = await Deal.findOne({ _id: p.dealId, userId: p.userId }, { person: 1, client: 1, email: 1 }).lean();
  if (!p.firstViewAt) {
    return alertOwner(p.userId, {
      subject: `${who(deal)} opened your proposal`, title: `${who(deal)} just opened “${p.title}”`,
      lines: ['A good moment to be reachable — if you hear nothing in a few days, Clientline will suggest a short nudge.'], path: path(p), cta: 'See the proposal',
    });
  }
  if (p.lastViewAt && Date.now() - new Date(p.lastViewAt).getTime() > REOPEN_QUIET_MS) {
    return alertOwner(p.userId, {
      subject: `${who(deal)} is looking at your proposal again`, title: `${who(deal)} opened “${p.title}” again`,
      lines: [`They’ve now opened it ${p.views + 1} times. Coming back after a few quiet days often means they’re deciding — a short, friendly note can help.`], path: path(p), cta: 'See the proposal',
    });
  }
  return null;
}

async function onChanges(p, { name, text }) {
  const deal = await Deal.findOne({ _id: p.dealId, userId: p.userId }, { person: 1, client: 1, email: 1 }).lean();
  return alertOwner(p.userId, {
    subject: `${name || who(deal)} asked for changes to your proposal`, title: `${name || who(deal)} asked for changes to “${p.title}”`,
    lines: ['It’s in your Inbox too. Update the proposal and press Send again — they get the new version on the same link.'], quote: text, path: path(p), cta: 'Update the proposal',
  });
}

afterAccept(async (p, deal) => {
  const opt = p.options[p.acceptedBy.option];
  const fmt = new Intl.NumberFormat(p.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(opt.price / 100);
  await alertOwner(p.userId, {
    subject: `🎉 ${p.acceptedBy.name} accepted your proposal`, title: `${p.acceptedBy.name} accepted “${p.title}” — ${opt.name}, ${fmt}`,
    lines: ['They’ve been sent a thank-you with the PDF of what was agreed. The deposit invoice is drafted — check it and send it from Invoices.'],
    path: deal ? `/work?p=${deal._id}` : '/invoices', cta: 'Open the project',
  });
});

module.exports = { onOpened, onChanges };
