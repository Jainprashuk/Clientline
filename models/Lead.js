const mongoose = require('mongoose');

/**
 * Someone who may need what the user sells, with the evidence for it.
 *
 * A lead only exists once it passed the gates (lib/leads/gates.js); a held lead
 * passed every gate but reachability. Every fact shown to the user — and every
 * fact a first line may use — is a signal with its source, so nothing on this
 * row is unexplained. Emails come from source text only, never from AI.
 *
 * dedupeKey is one per account: the email, else the post URL, else the
 * normalised name. A second source finding the same lead adds its signals to
 * the existing row instead of making a new one (lib/leads/import.js).
 */
const SOURCES = ['paste', 'hn', 'news', 'web-post'];
// in-sequence: emails going out (models/Enrollment.js) · replied: they answered (Inbox).
const STATUSES = ['new', 'held', 'approved', 'in-sequence', 'replied', 'discarded'];
const DISCARD_REASONS = ['not-my-service', 'too-small', 'agency-or-recruiter', 'spam', 'already-know', 'bad-contact', 'other'];

const signalSchema = new mongoose.Schema({
  text: { type: String, required: true, maxlength: 400 },
  source: { type: String, required: true, maxlength: 80 },   // "HN · Freelancer? Seeking freelancer?", "Google News"
  url: { type: String, default: null, maxlength: 2000 },  // Google News links run past 600
  at: { type: Date, default: null },
}, { _id: false });

const leadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },

  name: { type: String, required: true, trim: true, maxlength: 160 },   // company, or the person
  person: { type: String, default: '', maxlength: 120 },
  title: { type: String, default: '', maxlength: 120 },
  email: { type: String, default: null, lowercase: true, trim: true },
  // high: on their post or site · medium: company domain that accepts mail · low: a guess
  emailConfidence: { type: String, enum: ['high', 'medium', 'low', null], default: null },
  domain: { type: String, default: null },

  source: { type: String, enum: SOURCES, required: true },
  sourceType: { type: String, enum: ['asked', 'trigger'], required: true },
  where: { type: String, default: '', maxlength: 200 },
  postUrl: { type: String, default: null, maxlength: 2000 },
  postedAt: { type: Date, default: null },

  about: { type: String, default: '', maxlength: 1500 },
  signals: { type: [signalSchema], default: [] },
  budget: { amount: Number, currency: String, hourly: Boolean },
  service: { type: String, default: '' },   // the profile service it matched

  fit: { type: Number, default: 0 },
  fitWhy: { type: [String], default: [] },

  opener: { type: String, default: '', maxlength: 600 },
  // Which signals and proof the first line was built from, shown beside it.
  openerSources: { type: [String], default: [] },
  openerState: { type: String, enum: ['none', 'written', 'edited', 'failed', 'skipped'], default: 'none' },
  openerError: { type: String, default: null },

  status: { type: String, enum: STATUSES, default: 'new' },
  sequenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  heldReason: { type: String, default: '' },
  discardReason: { type: String, enum: [...DISCARD_REASONS, null], default: null },
  decidedAt: { type: Date, default: null },

  dedupeKey: { type: String, required: true },
  companyKey: { type: String, default: null },
  runId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });

leadSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
leadSchema.index({ userId: 1, status: 1, fit: -1, createdAt: -1 });
leadSchema.index({ userId: 1, companyKey: 1 });
leadSchema.index({ userId: 1, source: 1, createdAt: -1 });

const Lead = mongoose.model('Lead', leadSchema);
module.exports = Lead;
Object.assign(module.exports, { SOURCES, STATUSES, DISCARD_REASONS });
