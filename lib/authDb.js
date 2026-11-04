const mongoose = require('mongoose');

/**
 * The shared account store: users, sessions, sign-in codes and access requests,
 * in Outreach's database (see lib/apps.js). Everything else Clientline keeps is
 * in its own database, on the default connection.
 *
 * useDb, not a second connection: both databases sit on the same Atlas cluster,
 * so this shares the default connection's pool instead of opening another — on
 * the M0 tier connections are the scarcer resource. It can be called before
 * db.js connects; it goes live with the default connection.
 */
const { authDb } = require('./config');

if (!authDb) throw new Error("AUTH_DB is not set — the name of Outreach's database");

module.exports = mongoose.connection.useDb(authDb, { useCache: true });
