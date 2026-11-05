#!/usr/bin/env node
/**
 * Invoices: sums in paise (no float drift), the payment split, the UPI link, and
 * when a reminder is suggested. No network, no database.
 *
 *   node scripts/test-invoice.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { totals, splitAmounts, upiLink, isUpiId } = require('../lib/invoices/math');
const { reminderFor } = require('../routes/invoices');
const { renderInvoice } = require('../lib/invoices/page');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };
const DAY = 864e5;

const t = totals([{ qty: 1, rate: 1590000 }, { qty: 3, rate: 33333 }], 18);
eq(t.subtotal, 1689999, 'subtotal in paise');
eq(t.tax, 304200, 'GST 18% rounded to the paisa');
eq(t.total, 1994199, 'total = subtotal + GST');
eq(totals([{ qty: 0.1, rate: 30 }, { qty: 0.2, rate: 30 }]).subtotal, 9, 'no float drift (0.1 + 0.2)');
eq(splitAmounts(5300000, [30, 40, 30]).join(), '1590000,2120000,1590000', '₹53,000 at 30/40/30');
eq(splitAmounts(5000050, [30, 40, 30]).reduce((a, b) => a + b, 0), 5000050, 'parts always add up to the price (last takes the remainder)');
eq(splitAmounts(4999900, [33, 33, 34]).slice(0, 2).every(x => x % 100 === 0), true, 'earlier parts are whole rupees');

const link = upiLink({ upiId: 'prashuk@okicici', payee: 'Prashuk Jain', amount: 1590000, note: 'INV-0001' });
eq(link, 'upi://pay?pa=prashuk%40okicici&pn=Prashuk%20Jain&am=15900.00&cu=INR&tn=INV-0001', 'UPI link: payee, amount with 2 decimals, INR, invoice number');
eq(isUpiId('prashuk@okicici'), true, 'a UPI ID');
eq(isUpiId('98765 43210'), false, 'a phone number is not a UPI ID');

const sent = (dueIn, extra = {}) => ({ status: 'sent', dueAt: new Date(Date.now() + dueIn * DAY), remindersSent: [], ...extra });
eq(/Due in 2 days/.test(reminderFor(sent(2)) || ''), true, 'two days before: heads-up suggested');
eq(reminderFor(sent(10)), null, 'not while it’s far off');
eq(/Overdue by 3 days/.test(reminderFor(sent(-3)) || ''), true, 'overdue: reminder suggested');
eq(reminderFor(sent(-3, { remindersSent: [new Date(Date.now() - DAY)] })), null, 'not again within a week of the last one');
eq(reminderFor({ ...sent(-3), status: 'paid' }), null, 'never for a paid invoice');
eq(reminderFor({ ...sent(-3), status: 'draft' }), null, 'never for a draft');

(async () => {
  const inv = { number: 'INV-0001', status: 'sent', currency: 'INR', items: [{ text: 'Deposit <script>', qty: 1, rate: 1590000 }], gstPercent: 0, subtotal: 1590000, tax: 0, total: 1590000, client: { name: 'Brewbox', email: 'r@b.in' }, dueAt: new Date(Date.now() + 7 * DAY), createdAt: new Date() };
  const html = await renderInvoice(inv, { from: { name: 'Prashuk', billing: { upiId: 'prashuk@okicici', legalName: 'Prashuk Jain' } } });
  eq(html.includes('<svg') && html.includes('upi://pay?pa=prashuk%40okicici'), true, 'INR with a UPI ID: a QR and an open-in-app link');
  eq(html.includes('Deposit &lt;script&gt;'), true, 'lines are escaped');
  const usd = await renderInvoice({ ...inv, currency: 'USD' }, { from: { name: 'P', billing: { upiId: 'prashuk@okicici', payDetails: 'PayPal: p@x.com' } } });
  eq(!usd.includes('<svg') && usd.includes('PayPal: p@x.com'), true, 'other currencies: your bank/PayPal details, no UPI');
  const paid = await renderInvoice({ ...inv, status: 'paid', paidAt: new Date() }, { from: { billing: { upiId: 'prashuk@okicici' } } });
  eq(paid.includes('Paid') && !paid.includes('<svg'), true, 'a paid invoice shows Paid, no QR');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
