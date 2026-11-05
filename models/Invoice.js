const mongoose = require('mongoose');

/**
 * An invoice: your details and the client's, lines, GST if you charge it, the total.
 * Sent as a link (/i/<token>) from your Gmail; Indian clients pay by UPI QR, others
 * by your bank or PayPal details. You mark it paid — there's no gateway.
 * Amounts in minor units; `number` is per user and gap-free (models/Counter.js).
 */
const STATUSES = ['draft', 'sent', 'viewed', 'paid', 'void'];
const KINDS = ['deposit', 'milestone', 'final', 'other'];

const invoiceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dealId: { type: mongoose.Schema.Types.ObjectId, default: null },
  proposalId: { type: mongoose.Schema.Types.ObjectId, default: null },
  number: { type: String, required: true, maxlength: 40 },
  kind: { type: String, enum: KINDS, default: 'other' },
  part: { type: Number, default: null },            // which part of the payment split (0 = deposit)
  client: {
    name: { type: String, default: '', maxlength: 160 },
    email: { type: String, default: '', maxlength: 200 },
    address: { type: String, default: '', maxlength: 500 },
    taxId: { type: String, default: '', maxlength: 40 },   // their GSTIN, if any
  },
  currency: { type: String, enum: ['INR', 'USD', 'EUR', 'GBP'], default: 'INR' },
  items: { type: [{ text: { type: String, maxlength: 300 }, qty: { type: Number, default: 1 }, rate: { type: Number, default: 0 }, _id: false }], default: [] },
  gstPercent: { type: Number, default: 0, min: 0, max: 28 },
  subtotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  note: { type: String, default: '', maxlength: 600 },
  status: { type: String, enum: STATUSES, default: 'draft' },
  issuedAt: { type: Date, default: null },
  dueAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  views: { type: Number, default: 0 },
  lastViewAt: { type: Date, default: null },
  remindersSent: { type: [Date], default: [] },
  tokenHash: { type: String, default: null },
  tokenEnc: { type: String, default: null },
}, { timestamps: true });

invoiceSchema.index({ userId: 1, status: 1, dueAt: 1 });
invoiceSchema.index({ userId: 1, dealId: 1 });
invoiceSchema.index({ userId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } });

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;
Object.assign(module.exports, { STATUSES, KINDS });
