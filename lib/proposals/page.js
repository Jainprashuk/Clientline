/**
 * What the client sees at /p/<token>: your three options (pick one), the terms,
 * one piece of your work, and an accept form. The same HTML is the in-app preview.
 */
const crypto = require('crypto');
const { page, escapeHtml: e } = require('../docs/page');

const fmt = (minor, currency) => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

/** SHA-256 of exactly what the client is shown and agrees to. */
function contentHash(p) {
  const shown = { title: p.title, intro: p.intro, currency: p.currency, options: (p.options || []).map(o => ({ name: o.name, price: o.price, weeks: o.weeks, items: o.items })), terms: p.terms, proof: p.proof || null };
  return crypto.createHash('sha256').update(JSON.stringify(shown)).digest('hex');
}

// Open for N days from when the latest version was sent.
const expiresAt = (p) => { const s = (p.versions && p.versions.length ? p.versions[p.versions.length - 1].sentAt : p.sentAt); return s ? new Date(new Date(s).getTime() + ((p.terms && p.terms.validDays) || 14) * 86400000) : null; };
const isExpired = (p, now = new Date()) => !!(expiresAt(p) && expiresAt(p) < now && p.status !== 'accepted');
const lastSent = (p) => (p.versions && p.versions.length ? p.versions[p.versions.length - 1].sentAt : p.sentAt);

const SPLIT_WORDS = ['to start', 'at the halfway demo', 'on delivery', 'at the end'];
function termsLine(t = {}) {
  const split = t.split && t.split.length ? t.split : [30, 40, 30];
  const parts = split.map((n, i) => `${n}% ${split.length === 2 && i === 1 ? 'on delivery' : SPLIT_WORDS[i] || 'later'}`);
  return `${parts.join(', ')}. ${t.rounds == null ? 2 : t.rounds} round${t.rounds === 1 ? '' : 's'} of changes included; anything outside this scope gets a separate quote first.`;
}

/**
 * @param {object} p      the proposal
 * @param {object} o      { from: {name, headline, site}, preview?: bool, error?: string, done?: bool }
 */
function renderProposal(p, { from = {}, preview = false, error = '', pdfHref = '', changesHref = '', notice = '' } = {}) {
  const hash = contentHash(p);
  const exp = expiresAt(p);
  const accepted = p.status === 'accepted' && p.acceptedBy;
  const expired = isExpired(p);
  const head = `<div class="card"><div class="tiny">Proposal${preview ? ' · preview — this is what your client sees' : ''}</div>
    <h1>${e(p.title)}</h1>
    <div class="small muted">From ${e(from.name || '')}${from.headline ? ` · ${e(from.headline)}` : ''}${exp && !accepted ? ` · open until ${exp.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}` : ''}</div>
    ${p.versions && p.versions.length > 1 && !accepted ? `<p class="small" style="margin:10px 0 0"><span class="chip">Updated — version ${p.versions.length}</span> sent ${new Date(lastSent(p)).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}, replacing the earlier one.</p>` : ''}
    ${notice ? `<div class="ok" style="margin-top:12px">${e(notice)}</div>` : ''}
    ${p.intro ? `<p style="margin:14px 0 0">${e(p.intro)}</p>` : ''}</div>`;

  const opts = (p.options || []).map((o, i) => {
    const chosen = accepted && p.acceptedBy.option === i;
    return `<label class="opt${o.suggested ? ' pick' : ''}">
      ${accepted || expired || preview ? '' : `<input type="radio" name="option" value="${i}"${o.suggested ? ' checked' : ''} required>`}
      <div class="row"><b>${e(o.name)}</b>${chosen ? '<span class="chip">Accepted</span>' : o.suggested ? '<span class="chip">Suggested</span>' : ''}</div>
      <div class="price">${fmt(o.price, p.currency)}</div><div class="tiny">${o.weeks} week${o.weeks === 1 ? '' : 's'}</div>
      <ul>${(o.items || []).map(x => `<li>${e(x)}</li>`).join('')}</ul></label>`;
  }).join('');

  const terms = `<div class="card"><h2>How it works</h2><p class="small" style="margin:0">${e(termsLine(p.terms))}</p>${p.terms && p.terms.note ? `<p class="small muted">${e(p.terms.note)}</p>` : ''}</div>`;
  const proof = p.proof && p.proof.title ? `<div class="card"><h2>Recent work</h2><p class="small" style="margin:0"><b>${e(p.proof.title)}</b> — ${e(p.proof.result)}${p.proof.url ? ` · <a href="${e(p.proof.url)}" rel="noopener" target="_blank">see it</a>` : ''}</p></div>` : '';
  const contact = `<p class="tiny">${e(from.name || '')}${from.site ? ` · ${e(from.site)}` : ''}${from.email ? ` · ${e(from.email)}` : ''}</p>`;

  let action;
  if (accepted) {
    action = `<div class="card"><div class="ok">Accepted by ${e(p.acceptedBy.name)} on ${new Date(p.acceptedBy.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} — ${e((p.options[p.acceptedBy.option] || {}).name || '')}.</div>
      <p class="small muted" style="margin-bottom:0">${e(from.name || 'They')} will be in touch with the next step. A copy was emailed to you${pdfHref ? ` — <a href="${e(pdfHref)}">download the PDF</a>` : ''}.</p></div>`;
  } else if (expired) {
    action = `<div class="card"><p style="margin:0">This proposal has expired. Reply to the email and ${e(from.name || 'they')} will send an updated one.</p></div>`;
  } else if (preview) {
    action = `<div class="card noprint"><p class="small muted" style="margin:0">Your client picks an option here, types their name and accepts.</p></div>`;
  } else {
    action = `<div class="card noprint"><h2>Accept</h2>
      ${error ? `<p style="color:#c0392b;margin:0 0 8px">${e(error)}</p>` : ''}
      <p class="small muted" style="margin:0">Pick an option above, then type your name to accept it. ${e(from.name || 'The freelancer')} gets a note and replies with the next step.</p>
      <label class="f" for="name">Your full name</label><input type="text" id="name" name="name" maxlength="120" required autocomplete="name">
      <input type="hidden" name="hash" value="${hash}">
      <div><button type="submit">Accept this proposal</button></div></div>`;
  }
  // Not quite right? They can say what to change instead of going quiet.
  const changes = !accepted && !expired && !preview && changesHref ? `<details class="card noprint"${p.status === 'changes' ? '' : ''}><summary style="cursor:pointer;font-weight:650">Want something changed? Ask for changes</summary>
    <form method="post" action="${e(changesHref)}"><p class="small muted" style="margin:8px 0 0">Tell ${e(from.name || 'them')} what you’d change — scope, price, timing. They’ll update the proposal and send it back on this same link.</p>
    <label class="f" for="cname">Your name</label><input type="text" id="cname" name="name" maxlength="120" required autocomplete="name">
    <label class="f" for="ctext">What would you change?</label><textarea id="ctext" name="text" rows="4" maxlength="3000" required style="font:inherit;width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink)"></textarea>
    <div><button type="submit" style="background:var(--ink2)">Send to ${e(from.name || 'them')}</button></div></form></details>` : '';
  const body = `${head}<form method="post" action="">${`<div class="card"><h2>Options</h2><div class="opts">${opts}</div></div>`}${terms}${proof}${action}</form>${changes}${contact}`;
  return page(p.title, body);
}

module.exports = { renderProposal, contentHash, isExpired, expiresAt, termsLine, lastSent };
