/**
 * What the client sees at /i/<token>: the invoice, and how to pay — a UPI QR for
 * rupees (any UPI app, no fee), your bank / PayPal details otherwise. Prints cleanly.
 */
const QRCode = require('qrcode');
const { page, escapeHtml: e } = require('../docs/page');
const { upiLink, isUpiId } = require('./math');

const fmt = (minor, currency) => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const lines = (s) => e(s).replace(/\n/g, '<br>');

/** @param {object} from { name, email, billing } */
async function renderInvoice(inv, { from = {}, preview = false } = {}) {
  const b = from.billing || {};
  const paid = inv.status === 'paid';
  const overdue = !paid && inv.dueAt && new Date(inv.dueAt) < new Date() && inv.status !== 'draft';
  let pay = '';
  if (!paid && inv.status !== 'void') {
    if (inv.currency === 'INR' && isUpiId(b.upiId)) {
      const link = upiLink({ upiId: b.upiId, payee: b.legalName || from.name, amount: inv.total, note: inv.number });
      const svg = await QRCode.toString(link, { type: 'svg', margin: 1, width: 200, errorCorrectionLevel: 'M' });
      pay = `<div class="card"><h2>Pay by UPI</h2><div class="row" style="align-items:center">
        <div style="width:200px;background:#fff;padding:6px;border-radius:10px">${svg}</div>
        <div style="flex:1;min-width:200px"><p style="margin:0 0 6px">Scan with any UPI app — GPay, PhonePe, Paytm, your bank’s app. The amount (<b>${fmt(inv.total, 'INR')}</b>) and invoice number fill in by themselves.</p>
        <p class="small muted" style="margin:0">UPI ID: <b>${e(b.upiId)}</b></p>
        <p class="noprint" style="margin:10px 0 0"><a href="${e(link)}">Open in a UPI app</a> (on your phone)</p></div></div>
        ${b.payDetails ? `<p class="small muted" style="margin:12px 0 0">Or by bank transfer:<br>${lines(b.payDetails)}</p>` : ''}</div>`;
    } else if (b.payDetails) {
      pay = `<div class="card"><h2>How to pay</h2><p class="small" style="margin:0">${lines(b.payDetails)}</p><p class="tiny" style="margin-top:8px">Please put <b>${e(inv.number)}</b> in the payment reference.</p></div>`;
    } else {
      pay = `<div class="card"><p class="small muted" style="margin:0">Reply to the email for payment details.</p></div>`;
    }
  }
  const rows = inv.items.map(it => `<tr><td>${e(it.text)}</td><td class="n">${it.qty}</td><td class="n">${fmt(it.rate, inv.currency)}</td><td class="n">${fmt(Math.round(it.qty * it.rate), inv.currency)}</td></tr>`).join('');
  const body = `
  <div class="card">
    <div class="row"><div><div class="tiny">${preview ? 'Preview — this is what your client sees' : 'Invoice'}</div><h1>${e(inv.number)}</h1></div>
      <div style="text-align:right">${paid ? `<div class="ok">Paid ${day(inv.paidAt)}</div>` : inv.status === 'void' ? '<div class="tiny">Cancelled</div>' : `<div class="price">${fmt(inv.total, inv.currency)}</div><div class="tiny" ${overdue ? 'style="color:#c0392b"' : ''}>Due ${day(inv.dueAt)}${overdue ? ' · overdue' : ''}</div>`}</div></div>
    <div class="row" style="margin-top:14px;align-items:flex-start">
      <div class="small"><div class="tiny">From</div><b>${e(b.legalName || from.name || '')}</b>${b.address ? `<br>${lines(b.address)}` : ''}${b.taxId ? `<br>${b.taxId.length === 15 ? 'GSTIN' : 'PAN'}: ${e(b.taxId)}` : ''}${from.email ? `<br>${e(from.email)}` : ''}</div>
      <div class="small"><div class="tiny">To</div><b>${e(inv.client.name || inv.client.email)}</b>${inv.client.address ? `<br>${lines(inv.client.address)}` : ''}${inv.client.taxId ? `<br>GSTIN: ${e(inv.client.taxId)}` : ''}</div>
      <div class="small"><div class="tiny">Issued</div>${day(inv.issuedAt || inv.createdAt)}</div>
    </div>
  </div>
  <div class="card"><table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody>
    <tfoot>${inv.tax ? `<tr><td colspan="3" class="n">Subtotal</td><td class="n">${fmt(inv.subtotal, inv.currency)}</td></tr><tr><td colspan="3" class="n">GST ${inv.gstPercent}%</td><td class="n">${fmt(inv.tax, inv.currency)}</td></tr>` : ''}
    <tr><td colspan="3" class="n"><b>Total</b></td><td class="n"><b>${fmt(inv.total, inv.currency)}</b></td></tr></tfoot></table>
    ${inv.note ? `<p class="small muted">${lines(inv.note)}</p>` : ''}</div>
  ${pay}
  <p class="noprint tiny"><a href="javascript:window.print()">Print or save as PDF</a></p>`;
  return page(`${inv.number} — ${b.legalName || from.name || 'Invoice'}`, body);
}

module.exports = { renderInvoice, fmt };
