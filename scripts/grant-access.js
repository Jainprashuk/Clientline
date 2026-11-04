#!/usr/bin/env node
/**
 * Let someone into Clientline. The invite path until the admin app exists.
 *
 * Clientline is invite-only, exactly like Outreach. The account store is shared
 * (lib/apps.js), so:
 *   - an Outreach user gets 'clientline' added to their existing account;
 *   - a new address gets an invited account for Clientline only.
 * A pending access request for Clientline from that address is marked approved.
 * Nothing is emailed: tell them yourself, or approve from the admin app later.
 *
 *   node scripts/grant-access.js --email=you@example.com                (dev)
 *   node scripts/grant-access.js --email=you@example.com --env=prod
 *   node scripts/grant-access.js --email=you@example.com --revoke       remove Clientline only
 */
require('dotenv').config();

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };

// Read by lib/authDb.js and db.js, so it must be set before either loads.
if (value('env') === 'prod') process.env.NODE_ENV = 'prod';
else process.env.NODE_ENV = 'dev';

const mongoose = require('mongoose');
const db = require('../db');
const User = require('../models/User');
const AccessRequest = require('../models/AccessRequest');
const { APP, hasApp } = require('../lib/apps');
const { destroyAllForUser } = require('../lib/session');

async function main() {
  const email = String(value('email') || '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Pass --email=');
  await db.connect();

  const user = await User.findOne({ email }, { apps: 1, status: 1 }).lean();

  if (flag('revoke')) {
    if (!user || !hasApp(user)) return console.log(`${email} has no ${APP} access — nothing to do`);
    await User.updateOne({ _id: user._id }, { $pull: { apps: APP } });
    // Sessions are app-scoped, so this signs them out of Clientline only.
    const { deletedCount } = await destroyAllForUser(user._id, APP);
    return console.log(`Removed ${APP} from ${email}; ended ${deletedCount} session(s). Other apps untouched.`);
  }

  if (user && hasApp(user)) {
    console.log(`${email} already has ${APP} access (status: ${user.status})`);
  } else if (user) {
    await User.updateOne({ _id: user._id }, { $addToSet: { apps: APP } });
    console.log(`Added ${APP} to the existing account ${email} (apps were: ${(user.apps || []).join(', ') || 'none'})`);
  } else {
    await User.create({ email, apps: [APP], status: 'invited', invitedAt: new Date() });
    console.log(`Created an invited ${APP} account for ${email}`);
  }

  const r = await AccessRequest.updateOne(
    { email, app: APP, status: 'pending' },
    { $set: { status: 'approved', decidedAt: new Date() } },
  );
  if (r.modifiedCount) console.log('Marked their pending access request approved');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
