const mongoose = require('mongoose');

/**
 * One lead in one sequence: which step is next and when. A lead is in at most one
 * active sequence at a time (the partial unique index).
 *
 * Sending claims an enrollment (sendingUntil) before it talks to Gmail, so two
 * "Send due emails" presses can never send the same step twice (lib/outreach/send.js).
 */
const STATUSES = ['active', 'paused', 'stopped', 'done'];
const STOP_REASONS = ['replied', 'bounced', 'unsubscribed', 'manual', 'no-email', 'auto-reply', null];

const enrollmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, required: true },
  sequenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  step: { type: Number, default: 0 },          // index of the NEXT step to send
  nextAt: { type: Date, default: Date.now },
  status: { type: String, enum: STATUSES, default: 'active' },
  stopReason: { type: String, enum: STOP_REASONS, default: null },
  pausedUntil: { type: Date, default: null },  // an auto-reply: back on this date
  enrolledAt: { type: Date, default: Date.now },
  threadSubject: { type: String, default: '' },
  firstMessageId: { type: String, default: null },
  lastMessageId: { type: String, default: null },
  sendingUntil: { type: Date, default: null }, // claim: one sender at a time
  lastError: { type: String, default: null },
  // Your own wording for the NEXT email to this lead (edited on Outreach before sending).
  // Only used while `step` still matches; cleared once that email goes.
  edits: {
    type: new mongoose.Schema({ step: Number, subject: String, body: String }, { _id: false }),
    default: null,
  },
}, { timestamps: true });

enrollmentSchema.index({ userId: 1, status: 1, nextAt: 1 });
enrollmentSchema.index({ userId: 1, sequenceId: 1, status: 1 });
enrollmentSchema.index({ userId: 1, email: 1 });
enrollmentSchema.index({ userId: 1, leadId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['active', 'paused'] } } });

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
module.exports = Enrollment;
Object.assign(module.exports, { STATUSES, STOP_REASONS });
