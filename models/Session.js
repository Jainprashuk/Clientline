const mongoose = require('mongoose');
const authDb = require('../lib/authDb');
const { APPS } = require('../lib/apps');

// Sessions live in the DB rather than in a signed JWT so they can be revoked
// server-side — "log out everywhere" and "someone else has my cookie" both need
// a server-side kill switch, which a stateless token cannot give.
const sessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // The cookie carries the raw token; only its hash is stored, so a dump of this
  // collection cannot be replayed as a login.
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  // The app that issued it. The collection is shared with Clientline, and a
  // session only works in its own app (lib/session.js resolveSession).
  app: { type: String, enum: APPS, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

sessionSchema.index({ tokenHash: 1 }, { unique: true });
// Mongo reaps expired sessions on its own; nothing in the app has to sweep them.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// The shared account store (lib/authDb.js) — the one line that differs from
// Outreach's copy, which registers on its own default connection.
module.exports = authDb.model('Session', sessionSchema);
