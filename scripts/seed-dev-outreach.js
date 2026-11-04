#!/usr/bin/env node
/**
 * Dev only: a clean slate for trying Outreach end to end with real email, sent
 * only to the owner's own addresses.
 *
 *   node scripts/seed-dev-outreach.js            reset + seed
 *   node scripts/seed-dev-outreach.js --due      make every active sequence's next email due now
 *                                                (to test follow-ups without waiting days)
 *
 * Reset: removes this account's sequence enrolments, sent emails, conversations and
 * blocklist entries made while testing, so nothing can follow up on a real company,
 * and puts those leads back in New. Removes the placeholder Gmail so you connect yours.
 * Seed: three test leads in New, each with a first line:
 * Send FROM 29jainprashuk@gmail.com (connect it in Free connections); the leads go TO the
 * owner's second account, so replies come from a different address, as a client's would:
 *   - "Test · Acme Labs"      → prashukjain2905@gmail.com  (reply from here to test Inbox)
 *   - "Test · Brightside"     → prashukjain2905+brightside@gmail.com (same inbox, a second lead)
 *   - "Test · Bounce check"   → an address that doesn't exist, to see a bounce handled
 * plus a held lead (no email). Refuses to run against production.
 */
require('dotenv').config();
if (['prod', 'production'].includes(process.env.NODE_ENV) || process.env.VERCEL) {
  console.error('Refusing: this is for the dev database only.');
  process.exit(1);
}
const mongoose = require('mongoose');
const db = require('../db');
const User = require('../models/User');
const Lead = require('../models/Lead');
const Enrollment = require('../models/Enrollment');
const SentEmail = require('../models/SentEmail');
const Conversation = require('../models/Conversation');
const Blocklist = require('../models/Blocklist');
const Settings = require('../models/Settings');
const Sequence = require('../models/Sequence');
const { STARTER } = require('../lib/outreach/render');

const OWNER = process.argv.find(a => a.startsWith('--email='))?.slice(8) || '29jainprashuk@gmail.com';
const now = new Date();

const TEST_LEADS = [
  {
    name: 'Test · Acme Labs', person: 'Prashuk Test', title: 'Founder', email: 'prashukjain2905@gmail.com',
    about: 'Test lead. Our startup is looking for a freelance React developer to build our customer web app. Budget around ₹80,000.',
    opener: 'You posted that your startup needs a freelance React developer for your customer web app, and that is exactly the work I do.',
  },
  {
    name: 'Test · Brightside', person: 'Prashuk Gmail', title: 'Owner', email: 'prashukjain2905+brightside@gmail.com',
    about: 'Test lead. Need help with our Next.js frontend for the online store.',
    opener: 'You mentioned your Next.js frontend for the online store needs help — I build and speed up Next.js stores.',
  },
  {
    name: 'Test · Bounce check', person: 'Nobody', title: '', email: `clientline.bounce.test.${Math.floor(Math.random() * 1e8)}@gmail.com`,
    about: 'Test lead whose address does not exist, to see a bounce handled.',
    opener: 'You posted about rebuilding your web app — this address does not exist, so this email should bounce.',
  },
];

async function makeDue(user) {
  const r = await Enrollment.updateMany({ userId: user._id, status: { $in: ['active', 'paused'] } }, { $set: { status: 'active', nextAt: new Date(Date.now() - 1000), pausedUntil: null } });
  // The one-email-per-address-per-day guard would hold them back otherwise.
  await SentEmail.updateMany({ userId: user._id, sentAt: { $gt: new Date(Date.now() - 86400000) } }, [{ $set: { sentAt: { $subtract: ['$sentAt', 86400000] } } }]);
  console.log(`Made ${r.modifiedCount} sequence step(s) due now.`);
}

async function main() {
  await db.connect();
  const user = await User.findOne({ email: OWNER });
  if (!user) throw new Error(`No account ${OWNER} on dev`);

  if (process.argv.includes('--due')) return makeDue(user);

  // ── Reset what testing left behind ───────────────────────────────────────
  const touched = await Enrollment.distinct('leadId', { userId: user._id });
  const [e, s, c, b] = await Promise.all([
    Enrollment.deleteMany({ userId: user._id }),
    SentEmail.deleteMany({ userId: user._id }),
    Conversation.deleteMany({ userId: user._id }),
    Blocklist.deleteMany({ userId: user._id }),
  ]);
  await Lead.updateMany({ userId: user._id, _id: { $in: touched }, status: { $in: ['in-sequence', 'replied'] } }, { $set: { status: 'new', sequenceId: null } });
  await Lead.deleteMany({ userId: user._id, name: /^Test · / });
  await Settings.updateOne({ userId: user._id }, { $set: { gmailEmail: '', gmailAppPasswordEnc: '', sendingPausedUntil: null, 'mailbox.lastCheckAt': null, 'mailbox.scanUntil': null, 'mailbox.lastError': null } });
  console.log(`Cleared: ${e.deletedCount} enrolments, ${s.deletedCount} sent emails, ${c.deletedCount} conversations, ${b.deletedCount} blocklist entries; the placeholder Gmail.`);

  // ── Seed ─────────────────────────────────────────────────────────────────
  for (const t of TEST_LEADS) {
    await Lead.create({
      userId: user._id, name: t.name, person: t.person, title: t.title, email: t.email, emailConfidence: 'high',
      domain: t.email.split('@')[1], source: 'paste', sourceType: 'asked', where: 'Test data (scripts/seed-dev-outreach.js)',
      about: t.about, signals: [{ text: `“${t.about}”`, source: 'Test data', url: null, at: now }],
      service: 'Web apps', fit: 90, fitWhy: ['+90: test lead'], opener: t.opener, openerState: 'edited',
      status: 'new', dedupeKey: `e:${t.email}`, companyKey: `n:${t.name.toLowerCase()}`,
    });
  }
  await Lead.create({
    userId: user._id, name: 'Test · No email yet', source: 'paste', sourceType: 'asked', where: 'Test data',
    about: 'Test lead without an email: it should not be addable to a sequence.', signals: [{ text: 'Test', source: 'Test data' }],
    fit: 60, fitWhy: ['+60: test lead'], status: 'held', heldReason: 'No email found yet', dedupeKey: `n:test no email ${Date.now()}`,
  });
  if (!(await Sequence.exists({ userId: user._id }))) await Sequence.create({ userId: user._id, ...STARTER });
  await Sequence.updateMany({ userId: user._id }, { $set: { active: true } });
  console.log(`Added ${TEST_LEADS.length} test leads (New) and one without an email (No contact yet):`);
  for (const t of TEST_LEADS) console.log(`  ${t.name.padEnd(22)} ${t.email}`);
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
