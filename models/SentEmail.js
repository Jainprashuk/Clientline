const mongoose = require('mongoose');

/**
 * One email sent from the user's Gmail — a sequence step or a reply from Inbox.
 * The Message-ID is what a reply or a bounce is matched against
 * (lib/mailbox/scan.js), and these rows are what "sends today" counts.
 */
const sentEmailSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, default: null },
  enrollmentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  conversationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  kind: { type: String, enum: ['sequence', 'reply'], default: 'sequence' },
  step: { type: Number, default: null },
  from: { type: String, default: '' },
  to: { type: String, required: true, lowercase: true, trim: true },
  subject: { type: String, default: '' },
  text: { type: String, default: '', maxlength: 4000 },
  messageId: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
}, { versionKey: false });

sentEmailSchema.index({ userId: 1, sentAt: -1 });
sentEmailSchema.index({ userId: 1, messageId: 1 });
sentEmailSchema.index({ userId: 1, to: 1, sentAt: -1 });

const SentEmail = mongoose.model('SentEmail', sentEmailSchema);

/** Emails this account sent in the last 24 hours. */
SentEmail.sentToday = (userId) => SentEmail.countDocuments({ userId, sentAt: { $gt: new Date(Date.now() - 24 * 3600 * 1000) } });

module.exports = SentEmail;
