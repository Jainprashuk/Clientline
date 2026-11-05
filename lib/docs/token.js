/**
 * Links to a proposal or invoice page (/p/<token>, /i/<token>). The token is the
 * only key: 32 random bytes, looked up by its SHA-256 (like sessions). It is also
 * kept encrypted (lib/credentials.js) so you can copy the link again later.
 */
const crypto = require('crypto');
const { encrypt, decrypt } = require('../credentials');
const { appUrl } = require('../emailLayout');

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

function issueToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, tokenHash: hashToken(raw), tokenEnc: encrypt(raw) };
}

/** The page's public link, or '' when the app's public address is unknown. */
function linkFor(kind, doc) {
  if (!doc || !doc.tokenEnc || !appUrl()) return '';
  try { return `${appUrl()}/${kind}/${decrypt(doc.tokenEnc)}`; } catch { return ''; }
}

/** A visitor's IP, hashed with a server secret: enough to tell visits apart, not to identify anyone. */
const ipHash = (ip) => crypto.createHash('sha256').update(`${process.env.CREDENTIAL_KEY || ''}:${ip || ''}`).digest('hex').slice(0, 32);

module.exports = { issueToken, hashToken, linkFor, ipHash };
