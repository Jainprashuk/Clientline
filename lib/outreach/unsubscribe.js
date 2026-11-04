/**
 * The unsubscribe link at the foot of every outreach email.
 *
 * A token is "<payload>.<signature>": the payload says who sent it, to which
 * lead and address; the signature (HMAC-SHA256) proves Clientline made it, so
 * nobody can unsubscribe someone else by guessing a URL. The pattern is
 * Outreach's lib/lifecycle/unsubscribe.js, with its own key salt so a token
 * from one can never be used in the other. Tokens don't expire: an old email's
 * link must keep working.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const { appUrl } = require('../emailLayout');

const key = () => {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.CREDENTIAL_KEY;
  if (!secret) throw new Error('CREDENTIAL_KEY is not set');
  return crypto.createHash('sha256').update(`clientline-outreach-unsubscribe:${secret}`).digest();
};
const sign = (payload) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

function makeToken(userId, leadId, email) {
  const payload = Buffer.from(`${userId}.${leadId}.${String(email).toLowerCase()}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** { userId, leadId, email } or null when the token is malformed or not ours. */
function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const [userId, leadId, ...rest] = Buffer.from(payload, 'base64url').toString('utf8').split('.');
  const email = rest.join('.');
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(leadId) || !email.includes('@')) return null;
  return { userId, leadId, email };
}

/** The link, or '' when the app's public address is unknown (then no email is sent). */
function unsubscribeUrl(userId, leadId, email) {
  const base = appUrl();
  return base ? `${base}/u/${makeToken(userId, leadId, email)}` : '';
}

module.exports = { makeToken, readToken, unsubscribeUrl };
