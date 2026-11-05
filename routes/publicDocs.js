/**
 * Public pages a client opens from a link: /p/<token> (a proposal: view, accept).
 * No sign-in — the token is the key, looked up by its hash (lib/docs/token.js).
 * Mounted ahead of requireAuth, like /u.
 */
const express = require('express');
const Proposal = require('../models/Proposal');
const ProposalView = require('../models/ProposalView');
const Profile = require('../models/Profile');
const Settings = require('../models/Settings');
const { hashToken, ipHash } = require('../lib/docs/token');
const { notFound } = require('../lib/docs/page');
const { renderProposal } = require('../lib/proposals/page');
const { acceptProposal } = require('../lib/proposals/accept');

const proposals = express.Router();

async function sender(userId) {
  const [p, s] = await Promise.all([Profile.findOne({ userId }).lean(), Settings.findOne({ userId }, { senderName: 1, gmailEmail: 1 }).lean()]);
  return {
    name: (s && s.senderName) || (p && p.name) || '', headline: (p && p.headline) || '',
    site: String((p && p.portfolioUrl) || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''),
  };
}
const byToken = (raw) => (/^[\w-]{20,80}$/.test(raw) ? Proposal.findOne({ tokenHash: hashToken(raw) }).lean() : null);
const noStore = (res) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });

proposals.get('/:token', async (req, res) => {
  noStore(res);
  try {
    const p = await byToken(req.params.token);
    if (!p) return res.status(404).send(notFound());
    if (p.status !== 'accepted') {
      const now = new Date();
      await ProposalView.create({ proposalId: p._id, at: now, ipHash: ipHash(req.ip), ua: String(req.get('user-agent') || '').slice(0, 300) });
      await Proposal.updateOne({ _id: p._id }, {
        $inc: { views: 1 }, $set: { lastViewAt: now, ...(p.status === 'sent' ? { status: 'viewed' } : {}) },
        ...(p.firstViewAt ? {} : { $min: { firstViewAt: now } }),
      });
    }
    res.send(renderProposal(p, { from: await sender(p.userId) }));
  } catch (err) {
    res.status(500).send('Something went wrong. Please try again in a minute.');
  }
});

proposals.post('/:token', async (req, res) => {
  noStore(res);
  try {
    const p = await byToken(req.params.token);
    if (!p) return res.status(404).send(notFound());
    const b = req.body || {};
    const r = await acceptProposal(p, { name: b.name, option: b.option, hash: b.hash, ipHash: ipHash(req.ip) });
    const fresh = await Proposal.findById(p._id).lean();
    res.status(r.error ? 400 : 200).send(renderProposal(fresh, { from: await sender(p.userId), error: r.error || '' }));
  } catch (err) {
    res.status(500).send('Something went wrong. Please try again in a minute.');
  }
});

module.exports = { proposals };
