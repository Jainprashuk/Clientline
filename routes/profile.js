/**
 * My profile: read and save. Everything is cleaned here rather than trusted —
 * trimmed, lowercased where it is matched against text, de-duplicated and capped —
 * because the gates and the AI prompts read it verbatim.
 */
const express = require('express');
const Profile = require('../models/Profile');

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

function clean(body = {}) {
  const services = (Array.isArray(body.services) ? body.services : [])
    .map(s => ({ name: text(s && s.name, 80), keywords: phrases(s && s.keywords, LIMITS.keywords, 40), minBudget: money(s && s.minBudget) }))
    .filter(s => s.name)
    .slice(0, LIMITS.services);
  const src = body.sources || {};
  return {
    name: text(body.name, 80),
    headline: text(body.headline, 140),
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
      .map(c => ({ title: text(c && c.title, 120), result: text(c && c.result, 300), url: url(c && c.url) }))
      .filter(c => c.title && c.result)
      .slice(0, LIMITS.cases),
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

module.exports = router;
module.exports.clean = clean;
