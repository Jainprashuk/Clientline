/**
 * The PDF copy of an accepted proposal: what was agreed (the chosen option, its
 * price, time and what's included), how it's paid, the terms, and who accepted
 * when, with a record ID (the start of the content hash stored on acceptance).
 *
 * PDFKit's built-in fonts can't draw "₹", so amounts read "INR 70,000".
 */
const PDFDocument = require('pdfkit');
const { termsLine } = require('./page');
const { splitAmounts } = require('../invoices/math');

const amount = (minor, currency) => `${currency} ${new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 }).format(minor / 100)}`;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
// WinAnsi (the built-in fonts) has no ₹ and no emoji: keep what it can draw.
const safe = (s) => String(s || '').replace(/₹\s?/g, 'INR ').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…]/g, '');

/** @returns {Promise<Buffer>} */
function proposalPdf(p, { from = {}, client = '' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: safe(p.title), Author: safe(from.name) } });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const accent = '#4f46e5'; const grey = '#5b6070';
    const a = p.acceptedBy; const opt = a ? p.options[a.option] : p.options.find(o => o.suggested) || p.options[0];

    doc.fillColor(grey).fontSize(9).text(a ? 'AGREED PROPOSAL' : 'PROPOSAL', { characterSpacing: 1 });
    doc.moveDown(0.3).fillColor('#111').fontSize(20).text(safe(p.title));
    doc.moveDown(0.3).fillColor(grey).fontSize(10).text(`From ${safe(from.name)}${from.site ? ` · ${safe(from.site)}` : ''}${client ? `   ·   For ${safe(client)}` : ''}`);
    if (a) doc.moveDown(0.6).fillColor('#127a4a').fontSize(11).text(`Accepted by ${safe(a.name)} on ${day(a.at)} — ${safe(opt.name)}`);
    if (p.intro) doc.moveDown(0.8).fillColor('#111').fontSize(11).text(safe(p.intro), { lineGap: 2 });

    doc.moveDown(1).fillColor(accent).fontSize(13).text(`${safe(opt.name)} — ${amount(opt.price, p.currency)}`);
    doc.fillColor(grey).fontSize(10).text(`About ${opt.weeks} week${opt.weeks === 1 ? '' : 's'}`);
    doc.moveDown(0.4).fillColor('#111').fontSize(11);
    for (const it of opt.items) doc.text(`•  ${safe(it)}`, { indent: 6, lineGap: 2 });

    const split = p.terms && p.terms.split && p.terms.split.length ? p.terms.split : [100];
    const parts = splitAmounts(opt.price, split);
    const when = ['to start', 'at the halfway demo', 'on delivery', 'final'];
    doc.moveDown(1).fillColor('#111').fontSize(12).text('Payment');
    doc.fillColor('#111').fontSize(11);
    split.forEach((pct, i) => doc.text(`${pct}% ${split.length === 2 && i === 1 ? 'on delivery' : when[i] || 'later'}: ${amount(parts[i], p.currency)}`, { lineGap: 2 }));
    doc.moveDown(0.6).fillColor(grey).fontSize(10).text(safe(termsLine(p.terms)), { lineGap: 2 });
    if (p.terms && p.terms.note) doc.text(safe(p.terms.note), { lineGap: 2 });

    const others = p.options.filter(o => o !== opt);
    if (others.length) {
      doc.moveDown(1).fillColor(grey).fontSize(9).text(`Also offered: ${others.map(o => `${safe(o.name)} (${amount(o.price, p.currency)}, ${o.weeks} wk)`).join('; ')}`);
    }
    if (a) {
      doc.moveDown(2).fillColor(grey).fontSize(8).text(`Record ID ${String(a.contentHash || '').slice(0, 16)} — a fingerprint of exactly this proposal as it was accepted on ${day(a.at)}. Accepted online by typing their name.`, { lineGap: 1 });
    }
    doc.end();
  });
}

module.exports = { proposalPdf, amount };
