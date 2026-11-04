const mongoose = require('mongoose');

/**
 * A sequence: the emails a lead gets, and when. Step 1 is always an email; each
 * later email goes in the same Gmail thread ("Re: <step 1 subject>"), so its own
 * subject is not used. dayOffset counts from the day the lead was added.
 * A task step is a reminder for the user ("connect on LinkedIn"); nothing is sent.
 */
const MAX_STEPS = 5;

const stepSchema = new mongoose.Schema({
  kind: { type: String, enum: ['email', 'task'], default: 'email' },
  dayOffset: { type: Number, default: 0, min: 0, max: 60 },
  subject: { type: String, default: '', maxlength: 160 },
  body: { type: String, default: '', maxlength: 4000 },
}, { _id: false });

const sequenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  active: { type: Boolean, default: true },
  // New people started per day from this sequence; follow-ups are not counted.
  newPerDay: { type: Number, default: 15, min: 1, max: 100 },
  steps: { type: [stepSchema], default: [] },
}, { timestamps: true });

sequenceSchema.index({ userId: 1, createdAt: 1 });

const Sequence = mongoose.model('Sequence', sequenceSchema);
module.exports = Sequence;
module.exports.MAX_STEPS = MAX_STEPS;
