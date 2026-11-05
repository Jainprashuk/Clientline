/**
 * An email to YOU (your Clientline sign-in address) when something happens that
 * you'd want to know straight away: a client opened your proposal, asked for
 * changes, accepted. Sent by Clientline through Resend — not from your Gmail.
 * Never throws: a client's click must not fail because of your notification.
 */
const User = require('../models/User');
const { layout, heading, para, button, callout, escapeHtml: e, appHome, appTextLine } = require('./emailLayout');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * @param {object} o { subject, title, lines: string[] (plain text), quote?, path? (app path, e.g. '/proposals?p=…'), cta? }
 */
async function alertOwner(userId, { subject, title, lines = [], quote = '', path = '', cta = 'Open in Clientline' }) {
  try {
    const user = await User.findById(userId, { email: 1 }).lean();
    if (!user || !user.email) return { delivered: false };
    const link = appHome() && path ? `${appHome()}${path}` : appHome();
    const text = [title, '', ...lines, quote ? `\n“${quote}”\n` : '', link ? `${cta}: ${link}` : appTextLine()].join('\n');
    if (!process.env.RESEND_API_KEY || !process.env.OTP_FROM_EMAIL) {
      console.log(`[alert] ${user.email}: ${subject} (RESEND_API_KEY not set; not emailed)`);
      return { delivered: false, dev: true };
    }
    const html = layout({
      preheader: lines[0] || title,
      body: heading(e(title)) + lines.map(l => para(e(l))).join('') + (quote ? callout(e(quote).replace(/\n/g, '<br>'), { tone: 'muted' }) : '') + (link ? button(link, cta) : ''),
    });
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.OTP_FROM_EMAIL, to: [user.email], subject, text, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { console.error(`[alert] failed: Resend ${res.status}`); return { delivered: false }; }
    return { delivered: true };
  } catch (err) {
    console.error(`[alert] failed: ${err.message}`);
    return { delivered: false };
  }
}

module.exports = { alertOwner };
