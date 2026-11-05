/**
 * My profile: read and save. Everything is cleaned here rather than trusted —
 * trimmed, lowercased where it is matched against text, de-duplicated and capped —
 * because the gates and the AI prompts read it verbatim.
 */
const express = require('express');
const Profile = require('../models/Profile');
const { readResume } = require('../lib/profile/resume');

const { CLIENT_TYPES, COMPANY_SIZES, CURRENCIES, LIMITS, missingFor } = Profile;
const router = express.Router();

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const money = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 0;
};
/** Lowercase phrases, de-duplicated, empty ones dropped. */
const phrases = (list, cap, max = 60) => {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const p = text(raw, max).toLowerCase();
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= cap) break;
  }
  return out;
};
const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter(v => allowed.includes(v)))];
const url = (v) => {
  const s = text(v, 300);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
};

/** Payment split in whole percents adding to 100 (else the default), rounds, validity. */
function cleanTerms(t = {}) {
  const split = (Array.isArray(t.split) ? t.split : []).map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n > 0).slice(0, 4);
  return {
    split: split.length && split.reduce((a, b) => a + b, 0) === 100 ? split : [30, 40, 30],
    rounds: Math.min(10, Math.max(0, Math.round(Number(t.rounds)) || 0)) || (t.rounds === 0 ? 0 : 2),
    validDays: Math.min(90, Math.max(1, Math.round(Number(t.validDays)) || 14)),
  };
}

function cleanBilling(b = {}) {
  const upi = text(b.upiId, 120);
  return {
    legalName: text(b.legalName, 160),
    address: String(b.address == null ? '' : b.address).trim().slice(0, 500),
    taxId: text(b.taxId, 40).toUpperCase(),
    gstPercent: [0, 5, 12, 18, 28].includes(Number(b.gstPercent)) ? Number(b.gstPercent) : 0,
    upiId: /^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(upi) ? upi : '',
    payDetails: String(b.payDetails == null ? '' : b.payDetails).trim().slice(0, 800),
    prefix: text(b.prefix, 12).replace(/[^\w-]/g, '') || 'INV',
    paymentDays: Math.min(90, Math.max(0, Math.round(Number(b.paymentDays)) || 7)),
  };
}

function clean(body = {}) {
  const services = (Array.isArray(body.services) ? body.services : [])
    .map(s => ({ name: text(s && s.name, 80), keywords: phrases(s && s.keywords, LIMITS.keywords, 40), minBudget: money(s && s.minBudget) }))
    .filter(s => s.name)
    .slice(0, LIMITS.services);
  const src = body.sources || {};
  return {
    name: text(body.name, 80),
    headline: text(body.headline, 140),
    portfolioUrl: url(body.portfolioUrl),
    howIWork: text(body.howIWork, 160),
    availability: text(body.availability, 80),
    // Digits and the usual separators only: "+91 98765 43210", "(415) 555-0100".
    phone: text(body.phone, 30).replace(/[^\d+()\-. ]/g, '').trim(),
    services,
    currency: CURRENCIES.includes(body.currency) ? body.currency : 'INR',
    rate: money(body.rate),
    minProject: money(body.minProject),
    clientTypes: pick(body.clientTypes, CLIENT_TYPES),
    companySizes: pick(body.companySizes, COMPANY_SIZES),
    locations: phrases(body.locations, LIMITS.locations, 40),
    remoteOk: body.remoteOk !== false,
    exclusions: phrases(body.exclusions, LIMITS.exclusions),
    proof: (Array.isArray(body.proof) ? body.proof : [])
      .map(p => ({ who: text(p && p.who, 80), text: text(p && p.text, 400) }))
      .filter(p => p.text)
      .slice(0, LIMITS.proof),
    cases: (Array.isArray(body.cases) ? body.cases : [])
      .map(c => ({ title: text(c && c.title, 120), result: text(c && c.result, 300), url: url(c && c.url), service: text(c && c.service, 80), client: text(c && c.client, 80) }))
      .filter(c => c.title && c.result)
      .slice(0, LIMITS.cases),
    proposalTerms: cleanTerms(body.proposalTerms),
    billing: cleanBilling(body.billing),
    sources: {
      hn: src.hn !== false,
      news: src.news !== false,
      web: src.web !== false,
      webPerDay: Math.min(20, Math.max(1, Math.round(Number(src.webPerDay) || 5))),
    },
  };
}

const view = (p) => {
  const o = p.toObject ? p.toObject() : p;
  delete o._id; delete o.__v; delete o.userId;
  const missing = missingFor(o);
  return { profile: o, complete: missing.length === 0, missing };
};

router.get('/', async (req, res) => {
  try {
    res.json(view(await Profile.forUser(req.userId)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    await Profile.forUser(req.userId);
    const saved = await Profile.findOneAndUpdate(
      { userId: req.userId },
      { $set: clean(req.body) },
      { returnDocument: 'after', runValidators: true },
    );
    res.json(view(saved));
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Suggestions for the profile from a resume's text (read in the browser). Saves
 * nothing: the page shows them to tick, then saves through PUT / as usual.
 */
router.post('/from-resume', async (req, res) => {
  const { text, services } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Add your resume first.' });
  try {
    const r = await readResume(req.userId, text, services);
    if (!r.ok) return res.status(r.noKeys ? 400 : 422).json({ error: r.noKeys ? r.error : `Couldn’t read it cleanly: ${r.error}`, code: r.noKeys ? 'AI_KEY_REQUIRED' : undefined });
    res.json({ suggestion: r.suggestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.clean = clean;
