const mongoose = require('mongoose');

/**
 * One piece of possible work, from first conversation to paid. Created from an
 * Inbox reply, a lead, or by hand. Proposals and invoices move it between stages
 * (sent → Proposal sent, accepted → Won, last invoice paid → Paid); you move it
 * the rest of the way. Like Outreach's Interview: anyone in an open deal gets no
 * sequence emails (lib/deals/guard.js).
 *
 * Money is in minor units (paise / cents) so totals never drift.
 */
const STAGES = ['talking', 'call', 'proposal', 'won', 'progress', 'delivered', 'paid', 'lost'];
const OPEN = ['talking', 'call', 'proposal', 'won', 'progress', 'delivered'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

const dealSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, default: null },
  conversationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, required: true, trim: true, maxlength: 120 },     // "Checkout rebuild"
  client: { type: String, default: '', trim: true, maxlength: 120 },      // the company
  person: { type: String, default: '', trim: true, maxlength: 120 },
  email: { type: String, default: '', lowercase: true, trim: true, maxlength: 200 },
  value: { type: Number, default: 0, min: 0 },                            // minor units
  currency: { type: String, enum: CURRENCIES, default: 'INR' },
  stage: { type: String, enum: STAGES, default: 'talking' },
  lostReason: { type: String, default: '', maxlength: 200 },
  next: { type: String, default: '', trim: true, maxlength: 200 },        // your next step
  flags: { type: [{ rule: String, label: String, words: String, _id: false }], default: [] },
  callNotes: {
    budget: { type: String, default: '', maxlength: 300 },
    timeline: { type: String, default: '', maxlength: 300 },
    decider: { type: String, default: '', maxlength: 300 },
    done: { type: String, default: '', maxlength: 600 },   // what "done" looks like to them
    other: { type: String, default: '', maxlength: 2000 },
  },
  stageHistory: { type: [{ stage: String, at: Date, _id: false }], default: [] },
  lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true });

dealSchema.index({ userId: 1, stage: 1, lastActivityAt: -1 });
dealSchema.index({ userId: 1, leadId: 1 });
dealSchema.index({ userId: 1, email: 1 });

const Deal = mongoose.model('Deal', dealSchema);
module.exports = Deal;
Object.assign(module.exports, { STAGES, OPEN, CURRENCIES });
