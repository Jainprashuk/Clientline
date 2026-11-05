/**
 * Items from any source → stored leads. The one pipeline every source feeds:
 *
 *   contact (best email, confidence, dead domains dropped)
 *   → gates (lib/leads/gates.js) → score (lib/leads/score.js)
 *   → share cap for shared sources (models/LeadShare.js)
 *   → dedupe and store
 *
 * Adapted from Outreach's lib/leadImport.js: one row per lead per account,
 * deduped by email, else post URL, else name; a repeat adds its signals to the
 * existing row instead of overwriting it, and a lead the user already approved
 * or discarded is never brought back (gate 6).
 *
 * Returns counts plus every drop reason, so a run can say why it found nothing.
 */
const Lead = require('../../models/Lead');
const RunItem = require('../../models/RunItem');
const LeadShare = require('../../models/LeadShare');
const { judge } = require('./gates');
const { score, STACK_BONUS } = require('./score');
const { checkMx } = require('../mx');
const { mapLimit } = require('../http');
const { domainOf, FREE_MAIL } = require('../sources/emails');
const { isRoleAddress } = require('../emailPatterns');
const { readPosts } = require('./readPosts');

// Sources whose posts every user can see; capped per lead (LeadShare).
const SHARED = new Set(['hn', 'web-post']);

const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
// Tracking parameters go, but an id that names the post stays: every HN post is
// news.ycombinator.com/item?id=…, and without the id they were all one lead.
const normUrl = (u) => {
  const s = String(u || '').trim();
  const id = s.match(/[?&]id=([^&#]+)/);
  return s.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() + (id ? `?id=${id[1].toLowerCase()}` : '');
};

function dedupeKeyFor(lead) {
  if (lead.email) return `e:${lead.email.toLowerCase()}`;
  if (lead.postUrl) return `u:${normUrl(lead.postUrl)}`;
  return `n:${normName(lead.name)}`;
}

/** The company a lead belongs to, for stacking signals across sources. Free-mail domains say nothing. */
function companyKeyFor(lead) {
  const d = lead.domain || domainOf(lead.email);
  if (d && !FREE_MAIL.has(d)) return `d:${d.replace(/^www\./, '')}`;
  const n = normName(lead.name);
  return n ? `n:${n}` : null;
}

/**
 * Best address and how sure we are of it. Emails on the source itself are high;
 * a generic inbox (info@, hello@) is medium — reachable, but not the person who decides.
 */
function pickEmail(emails) {
  const list = (emails || []).filter(e => e && e.email);
  if (!list.length) return { email: null, confidence: null };
  const rank = (e) => (e.confidence === 'high' ? 0 : e.confidence === 'medium' ? 1 : 2) + (isRoleAddress(e.email) ? 0.5 : 0);
  const best = [...list].sort((a, b) => rank(a) - rank(b))[0];
  let confidence = best.confidence || 'high';
  if (confidence === 'high' && isRoleAddress(best.email)) confidence = 'medium';
  return { email: best.email.toLowerCase(), confidence };
}

/** Drops addresses on domains that cannot receive mail (no MX). Unknown counts as alive. */
async function dropDeadDomains(items) {
  const domains = [...new Set(items.flatMap(i => (i.emails || []).map(e => domainOf(e.email))).filter(Boolean))];
  const dead = new Set();
  await mapLimit(domains, 8, async (d) => { if ((await checkMx(d, { timeoutMs: 3000 })) === false) dead.add(d); });
  for (const i of items) i.emails = (i.emails || []).filter(e => !dead.has(domainOf(e.email)));
  return dead;
}

/** The stored shape of a lead from one item and its verdict. Shared with "This is a lead". */
function buildLead(userId, item, verdict, profile, { now = new Date(), runId = null } = {}) {
  const { email, confidence } = pickEmail(item.emails);
  item.emailConfidence = confidence;
  const { fit, fitWhy } = score(item, verdict, profile, now);
  const held = verdict.verdict === 'held' || !email;
  const lead = {
    userId,
    name: String(item.name || item.person || (email ? domainOf(email) : '') || 'Unknown').slice(0, 160),
    person: String(item.person || '').slice(0, 120),
    title: String(item.title || '').slice(0, 120),
    email,
    emailConfidence: confidence,
    domain: item.domain || (email && !FREE_MAIL.has(domainOf(email)) ? domainOf(email) : null),
    source: item.source,
    sourceType: item.sourceType || 'asked',
    where: String(item.where || '').slice(0, 200),
    postUrl: item.url || null,
    postedAt: item.postedAt || null,
    about: String(item.about || item.text || '').slice(0, 1500),
    signals: (item.signals || []).slice(0, 8),
    budget: verdict.budget ? { amount: verdict.budget.amount, currency: verdict.budget.currency, hourly: verdict.budget.hourly } : undefined,
    service: verdict.service ? verdict.service.name : '',
    fit,
    fitWhy,
    status: held ? 'held' : 'new',
    heldReason: held ? (verdict.verdict === 'held' ? verdict.reason : 'No email found yet') : '',
    runId,
  };
  lead.dedupeKey = dedupeKeyFor(lead);
  lead.companyKey = companyKeyFor(lead);
  return lead;
}

/** What a skipped item keeps, so it can become a lead later. Trimmed: it lives 14 days. */
const ITEM_FIELDS = ['source', 'sourceType', 'name', 'person', 'title', 'domain', 'location', 'remote', 'emails', 'url', 'where', 'postedAt', 'signals', 'triggerReason', 'needsByConstruction', 'ai'];
function compactItem(item) {
  const out = {};
  for (const k of ITEM_FIELDS) if (item[k] !== undefined) out[k] = item[k];
  out.text = String(item.text || '').slice(0, 1500);
  out.about = String(item.about || '').slice(0, 1500);
  return out;
}

/**
 * @param userId
 * @param items   normalised items from a source
 * @param profile the user's Profile (lean)
 * @param opts    { runId, now, dryRun, aiRead } — dryRun judges and scores without storing (paste
 *                preview); aiRead asks the user's AI whether each post is a client (lib/leads/readPosts.js)
 * @returns {{ read, kept, held, created, updated, repeats, capped, dropped, reasons: {}, leadIds: [], preview: [] }}
 */
async function importItems(userId, items, profile, { runId = null, now = new Date(), dryRun = false, aiRead = false, signal } = {}) {
  const out = { read: items.length, kept: 0, held: 0, created: 0, updated: 0, repeats: 0, capped: 0, dropped: 0, reasons: {}, leadIds: [], preview: [] };
  // Every item's outcome, written as RunItems at the end so the run can be opened later.
  const log = [];
  const note = (item, outcome, extra = {}) => {
    if (dryRun || !runId) return;
    log.push({
      userId, runId, source: item.source, outcome, reason: extra.reason || '',
      name: String(extra.name || item.name || item.person || '').slice(0, 160),
      text: String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      url: item.url || null, email: extra.email || null, fit: extra.fit ?? null, leadId: extra.leadId || null,
      item: outcome === 'drop' ? compactItem(item) : null,
    });
  };
  const drop = (reason, item) => {
    out.dropped++;
    out.reasons[reason] = (out.reasons[reason] || 0) + 1;
    if (dryRun) out.preview.push({ name: item.name || '', text: String(item.text || '').slice(0, 300), verdict: 'drop', reason });
    note(item, 'drop', { reason });
  };

  await dropDeadDomains(items);
  if (aiRead) await readPosts(userId, items, { signal });

  for (const item of items) {
    item.emailConfidence = pickEmail(item.emails).confidence;
    const verdict = judge(item, profile, now);
    if (verdict.verdict === 'drop') { drop(verdict.reason, item); continue; }

    const lead = buildLead(userId, item, verdict, profile, { now, runId });
    const { email, emailConfidence: confidence, fit, fitWhy } = lead;

    if (dryRun) {
      out.preview.push({ name: lead.name, text: String(item.text || '').slice(0, 300), verdict: lead.status, reason: lead.heldReason, fit, fitWhy, email, emailConfidence: confidence, service: lead.service });
      if (lead.status === 'held') out.held++; else out.kept++;
      continue;
    }

    const existing = await Lead.findOne({ userId, dedupeKey: lead.dedupeKey }, { status: 1, fit: 1, signals: 1 }).lean();
    if (existing) {
      // Gate 6: decided leads stay decided.
      if (existing.status === 'approved' || existing.status === 'discarded') {
        out.repeats++; out.reasons['Already decided'] = (out.reasons['Already decided'] || 0) + 1;
        note(item, 'repeat', { reason: `You already ${existing.status} it`, leadId: existing._id, fit, email });
        continue;
      }
      const seen = new Set((existing.signals || []).map(s => `${s.source}|${s.text}`));
      const fresh = lead.signals.filter(s => !seen.has(`${s.source}|${s.text}`));
      if (!fresh.length) { out.repeats++; note(item, 'repeat', { reason: 'Already in your leads', leadId: existing._id, fit, email }); continue; }
      await Lead.updateOne({ _id: existing._id }, {
        $push: { signals: { $each: fresh, $slice: -12 } },
        $max: { fit: lead.fit },
        ...(lead.status === 'new' && existing.status === 'held' && lead.email
          ? { $set: { status: 'new', heldReason: '', email: lead.email, emailConfidence: lead.emailConfidence } } : {}),
      });
      out.updated++;
      note(item, 'updated', { reason: 'Added to a lead you already had', leadId: existing._id, fit, email });
      continue;
    }

    // Shared sources: at most LeadShare.CAP accounts get the same post.
    if (SHARED.has(lead.source)) {
      const shareKey = lead.postUrl ? `u:${normUrl(lead.postUrl)}` : lead.dedupeKey;
      if (!(await LeadShare.claim(shareKey, userId))) {
        out.capped++; out.reasons['Already sent to other freelancers'] = (out.reasons['Already sent to other freelancers'] || 0) + 1;
        note(item, 'capped', { reason: 'Already sent to other freelancers', fit, email });
        continue;
      }
    }

    // Stacked signals: another source already points at this company.
    if (lead.companyKey) {
      const other = await Lead.findOne({ userId, companyKey: lead.companyKey, source: { $ne: lead.source }, status: { $in: ['new', 'held'] } }, { _id: 1, source: 1 }).lean();
      if (other) {
        lead.fit = Math.min(100, lead.fit + STACK_BONUS);
        lead.fitWhy = [...lead.fitWhy, `+${STACK_BONUS}: also found through another source`];
        await Lead.updateOne({ _id: other._id, fitWhy: { $not: /another source/ } }, {
          $inc: { fit: STACK_BONUS }, $push: { fitWhy: `+${STACK_BONUS}: also found through another source` },
        });
      }
    }

    try {
      const created = await Lead.create(lead);
      out.created++;
      if (lead.status === 'held') out.held++; else out.kept++;
      out.leadIds.push(created._id);
      note(item, lead.status === 'held' ? 'held' : 'lead', { reason: lead.heldReason, name: lead.name, leadId: created._id, fit: lead.fit, email });
    } catch (err) {
      if (err.code === 11000) { out.repeats++; note(item, 'repeat', { reason: 'Already in your leads', fit, email }); continue; } // a concurrent run stored it first
      // One bad row must not end the run and lose its counts: say so and move on.
      if (err.name === 'ValidationError') { console.error(`[leads/import] not saved: ${err.message}`); drop('Could not be saved', item); continue; }
      throw err;
    }
  }
  if (log.length) {
    // Never let the record of a run break the run itself.
    await RunItem.insertMany(log.slice(0, 500), { ordered: false }).catch(err => console.error(`[leads/import] run log: ${err.message}`));
  }
  return out;
}

module.exports = { importItems, buildLead, pickEmail, dedupeKeyFor, companyKeyFor, dropDeadDomains, SHARED, normUrl };
