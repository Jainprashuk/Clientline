/**
 * Who an account sends as, resolved per user and per send — never cached, never
 * stored decrypted. Adapted from Outreach's lib/mailer.js, minus its env-var
 * fallback and resume attachment.
 *
 * The Gmail connected in Clientline wins. Otherwise, when the user left sharing
 * on, the Gmail they saved in Outreach is used (read-only, like lib/outreachKeys.js);
 * both apps then share Gmail's daily sending limit.
 *
 * MAIL_DRY_RUN=1 (local only) logs messages instead of sending them.
 */
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const Settings = require('../models/Settings');
const User = require('../models/User');
const authDb = require('./authDb');
const { decrypt, decryptWith } = require('./credentials');
const { hasApp } = require('./apps');

const dryRun = () => process.env.MAIL_DRY_RUN === '1' && !process.env.VERCEL;

async function outreachGmail(userId) {
  if (!process.env.OUTREACH_CREDENTIAL_KEY) return null;
  const user = await User.findById(userId, { apps: 1 }).lean();
  if (!user || !hasApp(user, 'outreach')) return null;
  const s = await authDb.collection('settings').findOne(
    { userId: new mongoose.Types.ObjectId(String(userId)) },
    { projection: { gmailEmail: 1, gmailAppPasswordEnc: 1, senderName: 1 } },
  );
  if (!s || !s.gmailEmail || !s.gmailAppPasswordEnc) return null;
  try {
    const appPassword = decryptWith(s.gmailAppPasswordEnc, process.env.OUTREACH_CREDENTIAL_KEY);
    return appPassword ? { email: s.gmailEmail, appPassword, name: s.senderName && s.senderName !== 'Your Name' ? s.senderName : '' } : null;
  } catch (_) { return null; }
}

/**
 * The sending identity: { email, name, appPassword, from: 'clientline'|'outreach' }, or
 * null when no Gmail is available. Throws when a saved Clientline password can no longer
 * be decrypted — that must not quietly fall back to another login.
 */
async function getSender(userId) {
  const s = await Settings.findOne({ userId }, { gmailEmail: 1, gmailAppPasswordEnc: 1, senderName: 1, shareOutreach: 1 }).lean();
  if (s && s.gmailEmail && s.gmailAppPasswordEnc) {
    let appPassword;
    try { appPassword = decrypt(s.gmailAppPasswordEnc); }
    catch (err) { throw new Error(`Your saved Gmail password can no longer be read — connect Gmail again (${err.message})`); }
    return { email: s.gmailEmail, appPassword, name: s.senderName || '', from: 'clientline' };
  }
  if (s && s.shareOutreach === false) return null;
  const o = await outreachGmail(userId);
  return o ? { ...o, name: (s && s.senderName) || o.name, from: 'outreach' } : null;
}

/** The Gmail address in use, without touching the password. For display. */
async function senderInfo(userId) {
  const s = await Settings.findOne({ userId }, { gmailEmail: 1, gmailAppPasswordEnc: 1, senderName: 1, shareOutreach: 1 }).lean();
  if (s && s.gmailEmail && s.gmailAppPasswordEnc) return { email: s.gmailEmail, from: 'clientline', name: s.senderName || '' };
  const o = s && s.shareOutreach === false ? null : await outreachGmail(userId);
  return o ? { email: o.email, from: 'outreach', name: (s && s.senderName) || o.name } : null;
}

function transport(sender) {
  if (dryRun()) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: sender.email, pass: sender.appPassword },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}

/** Checks a login without sending anything. Resolves, or rejects with Gmail's error. */
function verify(email, appPassword) {
  if (dryRun()) return Promise.resolve(true);
  return transport({ email, appPassword }).verify();
}

// Gmail's own errors, from Outreach (lib/sendQuota.js, lib/sendNotifications.js).
const isQuotaError = (err) => {
  const text = `${err?.response || ''} ${err?.message || ''}`;
  return /\b5\.4\.5\b/.test(text) || /sending limit exceeded/i.test(text);
};
const isAuthError = (err) =>
  !!err && (err.code === 'EAUTH' || err.responseCode === 535 || /\b535\b|Username and Password not accepted|Invalid login/i.test(`${err.response || ''} ${err.message || ''}`));

module.exports = { getSender, senderInfo, transport, verify, isQuotaError, isAuthError, dryRun };
