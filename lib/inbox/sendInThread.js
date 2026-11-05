/**
 * Sends an email from the user's Gmail in a lead's conversation: a reply in the
 * thread when there is one (In-Reply-To / References, "Re:" subject), else a new
 * thread that becomes the conversation. Records the SentEmail and the message.
 * Used by Inbox replies, proposals, invoices and nudges.
 *
 * Errors carry `status: 400` when they're the user's to fix (no Gmail, login refused).
 */
const Conversation = require('../../models/Conversation');
const SentEmail = require('../../models/SentEmail');
const mailer = require('../mailer');
const { toHtml } = require('../outreach/send');

const userError = (msg) => Object.assign(new Error(msg), { status: 400 });

/**
 * @param {object} o { conversationId?, leadId?, email, subject (for a new thread), text, attachments? (nodemailer) }
 * @returns {Promise<{conversationId, messageId}>}
 */
async function sendInThread(userId, { conversationId = null, leadId = null, email = null, subject = '', text, attachments = null }) {
  let sender;
  try { sender = await mailer.getSender(userId); } catch (err) { throw userError(err.message); }
  if (!sender) throw userError('Connect Gmail in Free connections first.');

  const c = conversationId
    ? await Conversation.findOne({ _id: conversationId, userId }).lean()
    : leadId ? await Conversation.findOne({ userId, leadId }).lean() : null;
  const to = (c && c.email) || email;
  if (!to) throw userError('There’s no email address to send to.');

  const lastIn = c ? [...c.messages].reverse().find(m => m.direction === 'in') : null;
  const ids = c ? c.messages.map(m => m.messageId).filter(Boolean) : [];
  const base = String((c && c.subject) || (lastIn && lastIn.subject) || subject || '').replace(/^(?:re|aw|sv)\s*:\s*/i, '');
  const subj = c && ids.length ? `Re: ${base}` : base;
  if (!subj) throw userError('The email needs a subject.');

  const info = await mailer.transport(sender).sendMail({
    from: sender.name ? `"${sender.name.replace(/"/g, '')}" <${sender.email}>` : sender.email,
    to, subject: subj, text, html: toHtml(text), ...(attachments ? { attachments } : {}),
    ...(lastIn && lastIn.messageId ? { inReplyTo: lastIn.messageId } : {}),
    ...(ids.length ? { references: ids.slice(-10) } : {}),
  }).catch(err => {
    throw userError(mailer.isAuthError(err) ? 'Gmail refused the login — reconnect Gmail in Free connections.'
      : mailer.isQuotaError(err) ? 'Gmail’s daily sending limit is reached. Try again later.' : `Gmail error: ${err.message}`);
  });
  const messageId = info.messageId || `<dryrun-${Date.now()}-${Math.random().toString(36).slice(2)}@clientline.local>`;
  const at = new Date();
  const message = { direction: 'out', from: sender.email, subject: subj, text: text.slice(0, 8000), messageId, inReplyTo: lastIn ? lastIn.messageId : null, at };

  let convoId = c ? c._id : null;
  if (c) {
    await Conversation.updateOne({ _id: c._id }, { $push: { messages: { $each: [message], $slice: -50 } }, $set: { needsYou: false, lastAt: at, snoozedUntil: null } });
  } else if (leadId) {
    // A new thread (a deal started by hand): it becomes the conversation, so their
    // reply is matched to it and lands in Inbox.
    const created = await Conversation.create({ userId, leadId, email: to, subject: subj, messages: [message], needsYou: false, unread: false, lastAt: at, category: null });
    convoId = created._id;
  }
  await SentEmail.create({ userId, leadId: leadId || (c && c.leadId) || null, conversationId: convoId, kind: 'reply', from: sender.email, to, subject: subj, text: text.slice(0, 4000), messageId, sentAt: at });
  return { conversationId: convoId ? String(convoId) : null, messageId };
}

module.exports = { sendInThread };
