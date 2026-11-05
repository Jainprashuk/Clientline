/**
 * Proposals: draft one for a deal (AI or blank), edit, preview, send the link in
 * the deal's thread, nudge, delete a draft. Every query is scoped to req.userId.
 */
const express = require('express');
const mongoose = require('mongoose');
const Proposal = require('../models/Proposal');
const ProposalView = require('../models/ProposalView');
const Deal = require('../models/Deal');
const Profile = require('../models/Profile');
const Settings = require('../models/Settings');
const { draftProposal, gapsIn } = require('../lib/proposals/draft');
const { renderProposal, isExpired, expiresAt } = require('../lib/proposals/page');
const { issueToken, linkFor } = require('../lib/docs/token');
const { sendInThread } = require('../lib/inbox/sendInThread');
const { appUrl } = require('../lib/emailLayout');

const router = express.Router();
const validId = (id) => mongoose.isValidObjectId(id);
const DAY = 86400000;
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/** When a nudge would help, and why — never sent on its own. */
function nudgeFor(p, now = Date.now()) {
  if (!['sent', 'viewed'].includes(p.status) || !p.sentAt || isExpired(p)) return null;
  const since = Math.max(new Date(p.sentAt).getTime(), p.nudgedAt ? new Date(p.nudgedAt).getTime() : 0);
  if (!p.views && now - since > 2 * DAY) return 'Not opened in 2 days — a short note brings it back to the top of their inbox.';
  if (p.views && now - since > 3 * DAY) return `Opened ${p.views} time${p.views === 1 ? '' : 's'}, no answer in 3 days — a short follow-up lands well now.`;
  return null;
}

const view = (p, deal) => ({
  ...p, id: String(p._id), _id: undefined, userId: undefined, tokenHash: undefined, tokenEnc: undefined, __v: undefined,
  link: linkFor('p', p), gaps: gapsIn(p), nudge: nudgeFor(p), expired: isExpired(p), expiresAt: expiresAt(p),
  deal: deal ? { id: String(deal._id), name: deal.name, client: deal.client, person: deal.person, email: deal.email, stage: deal.stage } : undefined,
});

async function from(userId) {
  const [p, s] = await Promise.all([Profile.findOne({ userId }).lean(), Settings.findOne({ userId }, { senderName: 1, gmailEmail: 1 }).lean()]);
  return { name: (s && s.senderName) || (p && p.name) || '', headline: (p && p.headline) || '', site: String((p && p.portfolioUrl) || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') };
}

/** Options as sent from the editor: 1-3, each named, priced (major units in), with items. */
function cleanOptions(raw) {
  const opts = (Array.isArray(raw) ? raw : []).slice(0, 3).map(o => ({
    name: clean(o && o.name, 60),
    price: Math.round(Math.max(0, Number(o && o.price) || 0) * 100),
    weeks: Math.min(104, Math.max(1, Math.round(Number(o && o.weeks) || 1))),
    items: (Array.isArray(o && o.items) ? o.items : []).map(x => clean(x, 200)).filter(Boolean).slice(0, 12),
    suggested: !!(o && o.suggested),
  }));
  if (opts.length && !opts.some(o => o.suggested)) opts[Math.min(1, opts.length - 1)].suggested = true;
  return opts;
}

router.get('/', async (req, res) => {
  try {
    const q = { userId: req.userId };
    if (req.query.dealId && validId(req.query.dealId)) q.dealId = req.query.dealId;
    const list = await Proposal.find(q).sort({ updatedAt: -1 }).limit(300).lean();
    const deals = await Deal.find({ userId: req.userId, _id: { $in: list.map(p => p.dealId) } }, { name: 1, client: 1, person: 1, email: 1, stage: 1 }).lean();
    const by = new Map(deals.map(d => [String(d._id), d]));
    res.json({ proposals: list.map(p => view(p, by.get(String(p.dealId)))) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** A new proposal for a deal: { dealId, ai: true } drafts it with AI; otherwise a blank one priced from your minimum. */
router.post('/', async (req, res) => {
  const { dealId, ai } = req.body || {};
  if (!validId(dealId)) return res.status(404).json({ error: 'No such deal' });
  try {
    const deal = await Deal.findOne({ _id: dealId, userId: req.userId }).lean();
    if (!deal) return res.status(404).json({ error: 'No such deal' });
    let data;
    if (ai) {
      const r = await draftProposal(req.userId, dealId);
      if (!r.ok) return res.status(r.noKeys ? 400 : 422).json({ error: r.noKeys ? r.error : `No draft could be written: ${r.error}`, code: r.noKeys ? 'AI_KEY_REQUIRED' : undefined });
      data = { ...r.draft, draftedBy: 'ai' };
    } else {
      const p = (await Profile.findOne({ userId: req.userId }).lean()) || {};
      const base = Math.max(p.currency === deal.currency ? p.minProject || 0 : 0, deal.value ? deal.value / 100 : 0) || 10000;
      const terms = p.proposalTerms || {};
      data = {
        title: deal.name, intro: '', currency: deal.currency, draftedBy: 'you',
        options: [['Essentials', 1, 2], ['Standard', 1.6, 3], ['Complete', 2.4, 4]].map(([name, k, weeks], i) => ({ name, price: Math.round(base * k) * 100, weeks, items: ['[what’s included]'], suggested: i === 1 })),
        terms: { split: terms.split || [30, 40, 30], rounds: terms.rounds == null ? 2 : terms.rounds, validDays: terms.validDays || 14, note: '' },
      };
    }
    const created = await Proposal.create({ userId: req.userId, dealId: deal._id, ...data });
    res.status(201).json(view(created.toObject(), deal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such proposal' });
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p) return res.status(404).json({ error: 'No such proposal' });
    const [deal, views] = await Promise.all([
      Deal.findOne({ _id: p.dealId, userId: req.userId }).lean(),
      ProposalView.find({ proposalId: p._id }).sort({ at: -1 }).limit(20).lean(),
    ]);
    res.json({ ...view(p, deal), opens: views.map(v => ({ at: v.at, ua: v.ua })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such proposal' });
  const b = req.body || {};
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p) return res.status(404).json({ error: 'No such proposal' });
    if (p.status === 'accepted') return res.status(409).json({ error: 'It’s been accepted — it can’t change now. Start a new one for extra work.' });
    const $set = {};
    if (typeof b.title === 'string') { if (!clean(b.title, 160)) return res.status(400).json({ error: 'A proposal needs a title.' }); $set.title = clean(b.title, 160); }
    if (typeof b.intro === 'string') $set.intro = String(b.intro).trim().slice(0, 1500);
    if (b.options) {
      const opts = cleanOptions(b.options);
      if (!opts.length) return res.status(400).json({ error: 'Add at least one option.' });
      if (opts.some(o => !o.name || !o.price)) return res.status(400).json({ error: 'Every option needs a name and a price.' });
      $set.options = opts;
    }
    if (b.terms && typeof b.terms === 'object') {
      if (typeof b.terms.note === 'string') $set['terms.note'] = String(b.terms.note).trim().slice(0, 600);
      if (b.terms.rounds != null) $set['terms.rounds'] = Math.min(10, Math.max(0, Math.round(Number(b.terms.rounds)) || 0));
      if (b.terms.validDays != null) $set['terms.validDays'] = Math.min(90, Math.max(1, Math.round(Number(b.terms.validDays)) || 14));
      if (Array.isArray(b.terms.split)) {
        const split = b.terms.split.map(n => Math.round(Number(n))).filter(n => n > 0);
        if (split.reduce((a, c) => a + c, 0) !== 100) return res.status(400).json({ error: 'The payment split must add up to 100%.' });
        $set['terms.split'] = split.slice(0, 4);
      }
    }
    if (b.proof === null) $set.proof = null;
    const u = await Proposal.findOneAndUpdate({ _id: p._id, userId: req.userId }, { $set }, { returnDocument: 'after' }).lean();
    res.json(view(u));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Exactly what the client will see (opening it here doesn't count as their view). */
router.get('/:id/preview', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).send('Not found');
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p) return res.status(404).send('Not found');
    res.set('Cache-Control', 'no-store').send(renderProposal(p, { from: await from(req.userId), preview: true }));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/** The email that carries the link, before you edit it. */
function defaultMessage(p, deal, sender) {
  const first = String((deal && deal.person) || '').split(/\s+/)[0];
  return `Hi ${/^[A-Za-z][A-Za-z'-]+$/.test(first) ? first : 'there'},\n\nHere’s my proposal for “${p.title}” — ${p.options.length === 3 ? 'three options, with the one I’d suggest marked' : 'with the details'}:\n{{link}}\n\nYou can accept right on that page. Happy to adjust anything first.\n\n${sender.name || ''}`.trim();
}

router.get('/:id/message', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such proposal' });
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p) return res.status(404).json({ error: 'No such proposal' });
    const deal = await Deal.findOne({ _id: p.dealId, userId: req.userId }).lean();
    res.json({ text: defaultMessage(p, deal, await from(req.userId)), to: deal && deal.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Send the link in the deal's thread. { message } with {{link}} where the link goes. */
router.post('/:id/send', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such proposal' });
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p) return res.status(404).json({ error: 'No such proposal' });
    if (p.status === 'accepted') return res.status(409).json({ error: 'Already accepted.' });
    const gaps = gapsIn(p);
    if (gaps.length) return res.status(400).json({ error: `Fill in ${gaps.join(', ')} first.` });
    if (!p.options.length || p.options.some(o => !o.price || !o.items.length)) return res.status(400).json({ error: 'Every option needs a price and what’s included.' });
    if (!appUrl()) return res.status(400).json({ error: 'The app’s public address (CLIENTLINE_URL) is not set, so the link can’t be made.' });
    const deal = await Deal.findOne({ _id: p.dealId, userId: req.userId }).lean();
    if (!deal) return res.status(404).json({ error: 'No such deal' });
    if (!deal.email && !deal.conversationId) return res.status(400).json({ error: 'Add the client’s email to the deal first.' });

    // One link per proposal; sending again reuses it.
    let tok = p.tokenEnc ? null : issueToken();
    if (tok) await Proposal.updateOne({ _id: p._id }, { $set: { tokenHash: tok.tokenHash, tokenEnc: tok.tokenEnc } });
    const link = linkFor('p', tok ? { tokenEnc: tok.tokenEnc } : p);
    let text = String((req.body && req.body.message) || defaultMessage(p, deal, await from(req.userId))).replace(/\r\n?/g, '\n').trim();
    if (!text.includes('{{link}}') && !text.includes(link)) text = `${text}\n\n${link}`;
    text = text.replace('{{link}}', link).slice(0, 6000);

    const sent = await sendInThread(req.userId, {
      conversationId: deal.conversationId, leadId: deal.leadId, email: deal.email,
      subject: `Proposal: ${p.title}`, text,
    });
    const now = new Date();
    const u = await Proposal.findOneAndUpdate({ _id: p._id }, { $set: { status: p.status === 'viewed' ? 'viewed' : 'sent', sentAt: p.sentAt || now } }, { returnDocument: 'after' }).lean();
    const dealSet = { lastActivityAt: now, next: 'Wait for them to open it — nudge if quiet', ...(sent.conversationId && !deal.conversationId ? { conversationId: sent.conversationId } : {}) };
    const dealUpdate = { $set: dealSet };
    if (['talking', 'call'].includes(deal.stage)) { dealSet.stage = 'proposal'; dealUpdate.$push = { stageHistory: { stage: 'proposal', at: now } }; }
    await Deal.updateOne({ _id: deal._id }, dealUpdate);
    res.json(view(u, deal));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** A one-line follow-up in the thread, when you choose to. */
router.post('/:id/nudge', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such proposal' });
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p || !p.sentAt) return res.status(404).json({ error: 'Send the proposal first.' });
    const deal = await Deal.findOne({ _id: p.dealId, userId: req.userId }).lean();
    const text = String((req.body && req.body.message) || '').replace(/\r\n?/g, '\n').trim();
    if (text.length < 5) return res.status(400).json({ error: 'Write the follow-up first.' });
    await sendInThread(req.userId, { conversationId: deal && deal.conversationId, leadId: deal && deal.leadId, email: deal && deal.email, subject: `Proposal: ${p.title}`, text: text.replace('{{link}}', linkFor('p', p)).slice(0, 4000) });
    const u = await Proposal.findOneAndUpdate({ _id: p._id }, { $set: { nudgedAt: new Date() } }, { returnDocument: 'after' }).lean();
    if (deal) await Deal.updateOne({ _id: deal._id }, { $set: { lastActivityAt: new Date() } });
    res.json(view(u, deal));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'No such proposal' });
  try {
    const p = await Proposal.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!p) return res.status(404).json({ error: 'No such proposal' });
    if (p.status === 'accepted') return res.status(409).json({ error: 'An accepted proposal is the record of what was agreed — it stays.' });
    await Proposal.deleteOne({ _id: p._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.nudgeFor = nudgeFor;
