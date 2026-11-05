#!/usr/bin/env node
/**
 * One-off repair: until 5 Nov 2026 the post URL lost its query string in the
 * dedupe key, so every HN post (news.ycombinator.com/item?id=…) shared one key.
 * The first HN lead stored took that key, and every later HN post was counted
 * as "Already had" and pushed onto it as another signal.
 *
 * For each such lead: give it its own key, and take back the signals that came
 * from other posts — those posts are judged afresh on the next HN run. The share
 * cap row under the shared key goes too.
 *
 *   node scripts/fix-hn-dedupe.js                          dry run, configured database
 *   node scripts/fix-hn-dedupe.js --db=clientline_prod     dry run, another database on the cluster
 *   node scripts/fix-hn-dedupe.js --db=clientline_prod --apply
 */
require('dotenv').config();

const args = process.argv.slice(2);
const value = (n) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
const apply = args.includes('--apply');

const mongoose = require('mongoose');
const db = require('../db');
const { dedupeKeyFor, normUrl } = require('../lib/leads/import');

const BROKEN = /^u:https?:\/\/news\.ycombinator\.com\/item$/;

(async () => {
  await db.connect();
  const conn = value('db') ? mongoose.connection.useDb(value('db')) : mongoose.connection;
  const leads = conn.collection('leads');
  const shares = conn.collection('leadshares');
  console.log(`${apply ? 'APPLYING to' : 'Dry run on'} ${conn.name}\n`);

  for (const lead of await leads.find({ dedupeKey: BROKEN }).toArray()) {
    const key = dedupeKeyFor({ email: lead.email, postUrl: lead.postUrl, name: lead.name });
    const own = normUrl(lead.postUrl);
    const keep = (lead.signals || []).filter(s => !s.url || normUrl(s.url) === own);
    const gone = (lead.signals || []).length - keep.length;
    const clash = await leads.findOne({ userId: lead.userId, dedupeKey: key, _id: { $ne: lead._id } }, { projection: { name: 1 } });
    console.log(`${lead.name} (${lead._id}): ${lead.dedupeKey} → ${key}; ${gone} signal(s) from other posts removed${clash ? `; SKIPPED, ${clash.name} already has that key` : ''}`);
    for (const s of lead.signals || []) if (!keep.includes(s)) console.log(`   - ${String(s.text || '').slice(0, 90)}`);
    if (apply && !clash) await leads.updateOne({ _id: lead._id }, { $set: { dedupeKey: key, signals: keep } });
  }

  const shared = await shares.find({ key: BROKEN }).toArray();
  for (const s of shared) console.log(`Share cap row ${s.key} (${s.userIds.length} user(s)) removed`);
  if (apply && shared.length) await shares.deleteMany({ key: BROKEN });

  if (!apply) console.log('\nNothing changed. Run again with --apply.');
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
