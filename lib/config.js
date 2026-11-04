/**
 * Where the settings come from.
 *
 * The plain names — MONGODB_URI, AUTH_DB — are what each environment sets for
 * itself: Vercel holds production's values, a local .env holds dev's. Nothing
 * has to agree with NODE_ENV.
 *
 * The _DEV/_PROD names (Outreach's convention) still work as a fallback, picked
 * by NODE_ENV, so one local .env can carry both — scripts/grant-access.js
 * --env=prod relies on that.
 */
const prod = ['prod', 'production'].includes(process.env.NODE_ENV);
const pick = (base) => process.env[base] || process.env[`${base}_${prod ? 'PROD' : 'DEV'}`] || '';

const mongoUri = pick('MONGODB_URI');
// The NAME of Outreach's database — the shared account store (lib/authDb.js).
const authDb = pick('AUTH_DB');

const missing = [];
if (!mongoUri) missing.push('MONGODB_URI');
if (!authDb) missing.push('AUTH_DB');
// lib/emailOtp.js refuses to load on a deployment without these.
if (process.env.VERCEL) {
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!process.env.OTP_FROM_EMAIL) missing.push('OTP_FROM_EMAIL');
}

module.exports = { prod, mongoUri, authDb, missing };
