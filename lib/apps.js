/**
 * Which product this server is.
 *
 * Outreach and Clientline share ONE account store: the users, sessions, sign-in
 * codes and access requests collections in OUTREACH's database (lib/authDb.js
 * reaches it from here). An account can belong
 * to either app or both, recorded in User.apps. Everything else — contacts,
 * leads, settings, onboarding — belongs to one app and lives in that app's own
 * collections.
 *
 * These auth files are copies of Outreach's (lib/session.js, lib/loginCode.js
 * and the four models). Keep them identical apart from APP below and, in the
 * models, the authDb registration line, so that a plain diff shows any drift.
 * A change to one belongs in both repos.
 *
 * Admin rights (User.isAdmin) are global: the separate admin app manages both.
 */
const APP = 'clientline';
const APPS = ['outreach', 'clientline'];

/** Does this account have access to `app` (default: this one)? A missing or
 *  malformed `apps` means no — Outreach's db.js backfills pre-existing accounts. */
const hasApp = (user, app = APP) => Array.isArray(user && user.apps) && user.apps.includes(app);

/** A User query limited to this app's accounts. Every sweep over "all users"
 *  goes through this, or an Outreach-only account gets Clientline's crons and
 *  emails. */
const inApp = (filter = {}) => ({ ...filter, apps: APP });

module.exports = { APP, APPS, hasApp, inApp };
