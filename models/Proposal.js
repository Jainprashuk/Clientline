const mongoose = require('mongoose');

/**
 * A proposal for one deal: three options (one suggested), terms, one piece of your
 * work as proof. Sent as a link (/p/<token>) from your Gmail; the client opens it
 * and accepts on the page. Prices in minor units.
 *
 * acceptedBy is the record of the agreement: who typed their name, which option,
 * when, a hash of their IP, and a SHA-256 of exactly what the page showed.
 */
const STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'declined'];

const optionSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 60 },
  price: { type: Number, required: true, min: 0 },     // minor units
  weeks: { type: Number, required: true, min: 1, max: 104 },
  items: { type: [{ type: String, maxlength: 200 }], default: [] },
  suggested: { type: Boolean, default: false },
}, { _id: false });

const proposalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dealId: { type: mongoose.Schema.Types.ObjectId, required: true },
  title: { type: String, required: true, maxlength: 160 },
  intro: { type: String, default: '', maxlength: 1500 },
  currency: { type: String, enum: ['INR', 'USD', 'EUR', 'GBP'], default: 'INR' },
  options: { type: [optionSchema], default: [] },
  terms: {
    split: { type: [Number], default: [30, 40, 30] },   // % at start / halfway / delivery
    rounds: { type: Number, default: 2 },              // rounds of changes included
    validDays: { type: Number, default: 14 },
    note: { type: String, default: '', maxlength: 600 },
  },
  proof: { title: String, result: String, url: String },
  status: { type: String, enum: STATUSES, default: 'draft' },
  tokenHash: { type: String, default: null },
  tokenEnc: { type: String, default: null },
  sentAt: { type: Date, default: null },
  views: { type: Number, default: 0 },
  firstViewAt: { type: Date, default: null },
  lastViewAt: { type: Date, default: null },
  nudgedAt: { type: Date, default: null },
  acceptedBy: {
    type: new mongoose.Schema({ name: String, option: Number, at: Date, ipHash: String, contentHash: String }, { _id: false }),
    default: null,
  },
  draftedBy: { type: String, enum: ['ai', 'you'], default: 'you' },
}, { timestamps: true });

proposalSchema.index({ userId: 1, dealId: 1, createdAt: -1 });
proposalSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } });

const Proposal = mongoose.model('Proposal', proposalSchema);
module.exports = Proposal;
module.exports.STATUSES = STATUSES;
