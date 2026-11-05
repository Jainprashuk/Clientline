/**
 * Invoice sums in minor units (paise / cents) — integers all the way, so no float
 * drift — and the UPI payment link Indian clients scan. Pure.
 */

/** { subtotal, tax, total } for lines of { qty, rate (minor) } and a GST %. */
function totals(items = [], gstPercent = 0) {
  const subtotal = items.reduce((a, it) => a + Math.round((Number(it.qty) || 0) * (Number(it.rate) || 0)), 0);
  const tax = Math.round((subtotal * (Number(gstPercent) || 0)) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** A part of a price by percentage, rounded to whole rupees/dollars; the last part takes the remainder. */
function splitAmounts(price, split) {
  const parts = split.map(pct => Math.round((price * pct) / 100 / 100) * 100);
  parts[parts.length - 1] = price - parts.slice(0, -1).reduce((a, b) => a + b, 0);
  return parts;
}

/**
 * upi://pay link (NPCI's format) for an amount in paise. Any UPI app opens it, and
 * its QR. `tn` (the note) carries the invoice number so you can match the payment.
 */
function upiLink({ upiId, payee, amount, note }) {
  const p = new URLSearchParams({ pa: upiId, pn: String(payee || '').slice(0, 50), am: (amount / 100).toFixed(2), cu: 'INR', tn: String(note || '').slice(0, 60) });
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}

const isUpiId = (s) => /^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(String(s || ''));

module.exports = { totals, splitAmounts, upiLink, isUpiId };
