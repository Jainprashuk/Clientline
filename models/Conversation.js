const mongoose = require('mongoose');

/**
 * One lead's email conversation, once they've written back: every message both
 * ways (your sequence emails included, so the thread reads in order), what the
 * latest reply wants, and whether it is waiting on you.
 *
 * needsYou is stored, not derived, so the Inbox badge is one cheap count. It
 * becomes true when a reply needs an answer and false when you answer, mark it
 * done, or snooze it; a new reply wakes it.
 */
const CATEGORIES = ['wants-quote', 'wants-call', 'samples', 'interested', 'not-now', 'no', 'auto'];

const messageSchema = new mongoose.Schema({
  direction: { type: String, enum: ['in', 'out'], required: true },
  from: { type: String, default: '' },
  subject: { type: String, default: '' },
  text: { type: String, default: '', maxlength: 8000 },
  messageId: { type: String, default: null },
  inReplyTo: { type: String, default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, required: true },
  enrollmentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  email: { type: String, required: true, lowercase: true, trim: true },
  subject: { type: String, default: '' },
  messages: { type: [messageSchema], default: [] },
  // What the latest reply wants (null: not sorted — no AI key, or the AI failed).
  category: { type: String, enum: [...CATEGORIES, null], default: null },
  categoryWhy: { type: String, default: '' },
  categoryBy: { type: String, enum: ['rule', 'ai', 'you', null], default: null },
  needsYou: { type: Boolean, default: true },
  unread: { type: Boolean, default: true },
  snoozedUntil: { type: Date, default: null },
  doneAt: { type: Date, default: null },
  lastInboundAt: { type: Date, default: null },
  lastAt: { type: Date, default: Date.now },
}, { timestamps: true });

conversationSchema.index({ userId: 1, leadId: 1 }, { unique: true });
conversationSchema.index({ userId: 1, needsYou: 1, lastAt: -1 });
conversationSchema.index({ userId: 1, 'messages.messageId': 1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
module.exports.CATEGORIES = CATEGORIES;
