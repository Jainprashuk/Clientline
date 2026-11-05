import { useEffect, useState } from 'react';
import Drawer from './Drawer';
import InfoTip from './InfoTip';
import { useToast } from '../context/ToastContext';
import {
  deleteProposal, loadProposal, nudgeProposal, proposalMessage, proposalPdfUrl, proposalPreviewUrl, saveProposal, sendProposal,
  type Proposal,
} from '../lib/api';
import { money } from '../lib/money';
import { timeAgo } from '../lib/leads';

type Opt = { name: string; price: string; weeks: string; items: string; suggested: boolean };
const GAP = /\[[^\]\n]{1,60}\]/g;
const gapsOf = (s: string) => [...new Set(s.match(GAP) || [])];
const WHEN = ['to start', 'at the demo', 'on delivery', 'final'];
/** "₹21,000 to start · ₹28,000 at the demo · ₹21,000 on delivery" — same rounding as the invoices. */
function splitLine(price: number, split: number[], currency: Proposal['currency']) {
  if (!price || !split.length || split.reduce((a, b) => a + b, 0) !== 100) return '';
  const parts = split.map(p => Math.round((price * p) / 100 / 100) * 100);
  parts[parts.length - 1] = price - parts.slice(0, -1).reduce((a, b) => a + b, 0);
  return parts.map((a, i) => `${money(a, currency)} ${split.length === 2 && i === 1 ? 'on delivery' : WHEN[i] || 'later'}`).join(' · ');
}

const TIP = {
  title: 'The heading the client sees at the top of the proposal page and in the email subject.',
  intro: 'Two or three sentences to the client: what they need, in their words, and how you’d approach it.',
  options: 'Three ways to do the job at three prices. Clients compare options instead of saying yes or no to one price, so more of them accept. They pick one on the page.',
  price: 'The full price of this option, before GST. Invoices are split from it using the payment split below.',
  weeks: 'Roughly how long this option takes, in weeks.',
  items: 'What’s included — one line each. Anything not listed is outside the scope.',
  suggested: 'The option you recommend. It’s highlighted on the client’s page and picked by default.',
  split: 'How the price is paid, in %: e.g. 30 / 40 / 30 = 30% before you start, 40% at the halfway demo, 30% on delivery. Must add up to 100. Accepting creates the first invoice from it.',
  rounds: 'How many rounds of changes are included. More than that is quoted separately — it protects you from endless revisions.',
  valid: 'How many days the client has to accept after you send it. After that the page says it has expired and asks them to request a new one — so an old price can’t be accepted months later.',
  note: 'Any other condition, in one line: “GST extra”, “Hosting billed to you directly”, “Content provided by you”.',
};

const toForm = (p: Proposal) => ({
  title: p.title, intro: p.intro,
  options: p.options.map(o => ({ name: o.name, price: String(o.price / 100), weeks: String(o.weeks), items: o.items.join('\n'), suggested: o.suggested })) as Opt[],
  split: p.terms.split.join(' / '), rounds: String(p.terms.rounds), validDays: String(p.terms.validDays), note: p.terms.note,
});

/**
 * One proposal: its three options, terms, and what happened since it was sent.
 * Save, preview it as the client sees it, send the link in the deal's thread,
 * nudge when Clientline suggests it.
 */
export default function ProposalEditor({ id, onClose, onChanged, onDeleted }: {
  id: string; onClose: () => void; onChanged?: (p: Proposal) => void; onDeleted?: (id: string) => void;
}) {
  const toast = useToast();
  const [p, setP] = useState<Proposal | null>(null);
  const [f, setF] = useState<ReturnType<typeof toForm> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ kind: 'send' | 'nudge'; text: string } | null>(null);

  const fill = (x: Proposal) => { setP(x); setF(toForm(x)); onChanged?.(x); };
  useEffect(() => { loadProposal(id).then(x => { setP(x); setF(toForm(x)); }).catch(e => toast(e.message, 'error')); }, [id, toast]);

  if (!p || !f) return <Drawer title="Proposal" onClose={onClose}><div className="empty-state"><i className="ti ti-loader" />Loading…</div></Drawer>;

  const locked = p.status === 'accepted';
  const patch = () => ({
    title: f.title, intro: f.intro,
    options: f.options.map(o => ({ name: o.name, price: Number(o.price) || 0, weeks: Number(o.weeks) || 1, items: o.items.split('\n').map(x => x.trim()).filter(Boolean), suggested: o.suggested })),
    terms: { split: f.split.split(/[^\d]+/).map(Number).filter(Boolean), rounds: Number(f.rounds) || 0, validDays: Number(f.validDays) || 14, note: f.note },
  });
  const dirty = JSON.stringify(toForm(p)) !== JSON.stringify(f);
  const gaps = gapsOf([f.title, f.intro, f.note, ...f.options.flatMap(o => [o.name, o.items])].join('\n'));
  const run = async (key: string, fn: () => Promise<Proposal | void>, done?: string) => {
    setBusy(key);
    try { const x = await fn(); if (x) fill(x); if (done) toast(done, 'success'); return true; }
    catch (e: any) { toast(e.message, 'error', 8000); return false; }
    finally { setBusy(null); }
  };
  const save = () => run('save', () => saveProposal(p.id, patch()), 'Saved.');
  const openSend = async () => {
    if (dirty && !(await save())) return;
    try { const m = await proposalMessage(p.id); setCompose({ kind: 'send', text: m.text }); } catch (e: any) { toast(e.message, 'error'); }
  };
  const openNudge = () => setCompose({
    kind: 'nudge',
    text: `Hi ${(p.deal?.person || '').split(' ')[0] || 'there'},\n\nJust checking the proposal reached you — happy to walk you through it, or adjust an option if it doesn’t quite fit.\n\n{{link}}`,
  });
  const setOpt = (i: number, patchO: Partial<Opt>) => setF({ ...f, options: f.options.map((o, n) => (n === i ? { ...o, ...patchO } : patchO.suggested ? { ...o, suggested: false } : o)) });

  const status = p.status === 'accepted' && p.acceptedBy
    ? <span style={{ color: 'var(--green)' }}>Accepted by {p.acceptedBy.name} · {p.options[p.acceptedBy.option]?.name} · {timeAgo(p.acceptedBy.at)}{p.confirmedAt ? ' · PDF copy emailed' : ''}</span>
    : p.sentAt ? <>Sent {timeAgo(p.sentAt)} · {p.views ? `opened ${p.views}× · last ${timeAgo(p.lastViewAt!)}` : 'not opened yet'}{p.expired ? ' · expired' : ''}</>
    : 'Draft — not sent';

  return (
    <Drawer title={p.title || 'Proposal'} subtitle={<>{p.deal ? `${p.deal.client || p.deal.email} · ` : ''}{status}</>} onClose={onClose} width={720}
      footer={(
        <div className="cl-meta" style={{ width: '100%', flexWrap: 'wrap' }}>
          {!locked && <button className="btn btn-danger btn-sm" type="button" disabled={!!busy}
            onClick={async () => { if (window.confirm('Delete this proposal?')) { try { await deleteProposal(p.id); onDeleted?.(p.id); onClose(); } catch (e: any) { toast(e.message, 'error'); } } }}>Delete</button>}
          <a className="btn btn-sm" href={proposalPreviewUrl(p.id)} target="_blank" rel="noopener noreferrer"><i className="ti ti-eye" /> Preview</a>
          {p.link && <button className="btn btn-sm" type="button" onClick={() => navigator.clipboard.writeText(p.link).then(() => toast('Link copied.', 'success'))}><i className="ti ti-link" /> Copy link</button>}
          {locked && <a className="btn btn-sm" href={proposalPdfUrl(p.id)} target="_blank" rel="noopener noreferrer"><i className="ti ti-file-type-pdf" /> PDF</a>}
          <span style={{ flex: 1 }} />
          {!locked && dirty && <button className="btn" type="button" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>}
          {!locked && <button className="btn btn-primary" type="button" disabled={!!busy || gaps.length > 0}
            title={gaps.length ? 'Fill in the [gaps] first' : ''} onClick={openSend}>
            <i className="ti ti-send" /> {p.sentAt ? 'Send again' : 'Send to client'}
          </button>}
        </div>
      )}>
      {p.nudge && !compose && (
        <div className="info-box" style={{ marginBottom: 12 }}>
          <i className="ti ti-bell" /><div style={{ flex: 1 }}>{p.nudge}</div>
          <button className="btn btn-sm btn-primary" type="button" onClick={openNudge}>Write a nudge</button>
        </div>
      )}
      {compose && (
        <div className="cl-sect" style={{ background: 'var(--canvas)', borderRadius: 12, padding: 14, marginBottom: 12, border: '1px solid var(--border)' }}>
          <h3>{compose.kind === 'send' ? `Email to ${p.deal?.email || 'the client'} — in your thread with them` : 'Follow-up, in the same thread'}</h3>
          <textarea rows={8} value={compose.text} onChange={e => setCompose({ ...compose, text: e.target.value })} />
          <div className="cl-hint">{'{{link}}'} becomes the proposal’s link.</div>
          <div className="cl-meta" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" type="button" onClick={() => setCompose(null)}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" type="button" disabled={!!busy}
              onClick={() => run(compose.kind, () => (compose.kind === 'send' ? sendProposal(p.id, compose.text) : nudgeProposal(p.id, compose.text)),
                compose.kind === 'send' ? 'Sent from your Gmail. You’ll see when they open it.' : 'Follow-up sent.').then(ok => ok && setCompose(null))}>
              {busy === compose.kind ? 'Sending…' : 'Send from Gmail'}
            </button>
          </div>
        </div>
      )}

      {p.status === 'changes' && p.changeRequests && p.changeRequests.length > 0 && (
        <div className="info-box" style={{ marginBottom: 12, borderColor: 'var(--amber)' }}>
          <i className="ti ti-message-2" />
          <div style={{ flex: 1 }}>
            <b>{p.changeRequests[p.changeRequests.length - 1].name} asked for changes</b> · {timeAgo(p.changeRequests[p.changeRequests.length - 1].at)}
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{p.changeRequests[p.changeRequests.length - 1].text}</div>
            <div className="cl-row-sub" style={{ marginTop: 6 }}>Edit the options below, Save, then <b>Send again</b> — they get the new version on the same link, and the old one is kept in Versions.</div>
          </div>
        </div>
      )}
      {gaps.length > 0 && !locked && (
        <div className="cl-note" style={{ marginBottom: 10 }}>Fill in before sending: {gaps.map(g => <span key={g} className="cl-gap" style={{ marginRight: 4 }}>{g}</span>)}</div>
      )}
      {p.draftedBy === 'ai' && !p.sentAt && <div className="cl-hint" style={{ marginTop: 0 }}>Drafted from the thread, your call notes and your profile. Check every line and price — it’s your offer.</div>}

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-group"><label className="form-label" htmlFor="pr-title">Title <InfoTip text={TIP.title} /></label><input id="pr-title" type="text" maxLength={160} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="pr-intro">Intro, to them <InfoTip text={TIP.intro} /></label><textarea id="pr-intro" rows={3} maxLength={1500} value={f.intro} onChange={e => setF({ ...f, intro: e.target.value })} /></div>

        <div className="form-label" style={{ marginBottom: 6 }}>
          Options <InfoTip text={TIP.options} />
          <span className="cl-row-sub" style={{ fontWeight: 400, marginLeft: 8 }}>name · price <InfoTip text={TIP.price} /> · weeks <InfoTip text={TIP.weeks} /> · what’s included <InfoTip text={TIP.items} /></span>
        </div>
        <div className="cl-cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {f.options.map((o, i) => {
            // Once accepted, the one they chose is what matters — not the one you suggested.
            const chosen = locked && p.acceptedBy ? p.acceptedBy.option === i : o.suggested;
            return (
            <div key={i} className="cl-row" style={{ borderColor: chosen ? (locked ? 'var(--green)' : 'var(--accent)') : undefined, borderWidth: chosen ? 2 : undefined }}>
              <input type="text" aria-label={`Option ${i + 1} name`} value={o.name} maxLength={60} onChange={e => setOpt(i, { name: e.target.value })} style={{ fontWeight: 650 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input type="number" min={0} aria-label={`Option ${i + 1} price`} value={o.price} onChange={e => setOpt(i, { price: e.target.value })} />
                <input type="number" min={1} aria-label={`Option ${i + 1} weeks`} value={o.weeks} style={{ width: 70 }} onChange={e => setOpt(i, { weeks: e.target.value })} title="Weeks" />
              </div>
              <div className="cl-row-sub">{money(Number(o.price || 0) * 100, p.currency)} · {o.weeks} wk</div>
              {splitLine(Number(o.price || 0) * 100, f.split.split(/[^\d]+/).map(Number).filter(Boolean), p.currency) && (
                <div className="cl-row-sub" style={{ fontSize: 11.5 }}>{splitLine(Number(o.price || 0) * 100, f.split.split(/[^\d]+/).map(Number).filter(Boolean), p.currency)}</div>
              )}
              <textarea rows={6} aria-label={`What option ${i + 1} includes`} value={o.items} placeholder="One line per thing included" style={{ marginTop: 6 }} onChange={e => setOpt(i, { items: e.target.value })} />
              {locked && p.acceptedBy ? (
                p.acceptedBy.option === i
                  ? <div className="cl-meta" style={{ marginTop: 6, color: 'var(--green)', fontWeight: 650 }}><i className="ti ti-circle-check" /> Accepted</div>
                  : <div className="cl-row-sub" style={{ marginTop: 6 }}>{o.suggested ? 'You suggested this one' : 'Not chosen'}</div>
              ) : (
                <label className="cl-meta" style={{ marginTop: 6, cursor: 'pointer' }}>
                  <input type="radio" name="suggested" checked={o.suggested} onChange={() => setOpt(i, { suggested: true })} /> Suggested <InfoTip text={TIP.suggested} />
                </label>
              )}
            </div>
            );
          })}
        </div>

        <div className="cl-cols">
          <div className="form-group"><label className="form-label" htmlFor="pr-split">Payment split (%) <InfoTip text={TIP.split} /></label><input id="pr-split" type="text" value={f.split} placeholder="30 / 40 / 30" onChange={e => setF({ ...f, split: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="pr-rounds">Rounds of changes <InfoTip text={TIP.rounds} /></label><input id="pr-rounds" type="number" min={0} max={10} value={f.rounds} onChange={e => setF({ ...f, rounds: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="pr-valid">Open for (days) <InfoTip text={TIP.valid} /></label><input id="pr-valid" type="number" min={1} max={90} value={f.validDays} onChange={e => setF({ ...f, validDays: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label" htmlFor="pr-note">Anything else on terms (optional) <InfoTip text={TIP.note} /></label><input id="pr-note" type="text" maxLength={600} value={f.note} placeholder="Hosting is billed to you directly" onChange={e => setF({ ...f, note: e.target.value })} /></div>
      </fieldset>
      {p.proof && <div className="cl-row-sub">Shows your work: <b>{p.proof.title}</b> — {p.proof.result}</div>}
      {p.versions && p.versions.length > 0 && (
        <div className="cl-sect">
          <h3>Versions <InfoTip text="Each time you send the proposal with changes, the version the client saw before is kept here — so you can see what an earlier offer said." /></h3>
          {[...p.versions].reverse().map(v => (
            <details key={v.n} style={{ marginBottom: 6 }}>
              <summary className="cl-row-sub" style={{ cursor: 'pointer' }}>
                <b style={{ color: 'var(--text)' }}>v{v.n}</b> · sent {new Date(v.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {v.options.map(o => `${o.name} ${money(o.price, v.currency)}`).join(' / ')}{v.n === p.versions!.length ? ' · current' : ''}
              </summary>
              <div className="cl-row-sub" style={{ padding: '6px 0 0 14px' }}>
                {v.options.map(o => <div key={o.name}><b>{o.name}</b> — {money(o.price, v.currency)}, {o.weeks} wk: {o.items.join('; ')}</div>)}
                <div>Split {v.terms.split.join(' / ')} · {v.terms.rounds} rounds{v.terms.note ? ` · ${v.terms.note}` : ''}</div>
              </div>
            </details>
          ))}
          {p.changeRequests && p.changeRequests.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="cl-row-sub" style={{ fontWeight: 650 }}>Changes they asked for</div>
              {[...p.changeRequests].reverse().map((c, i) => <div key={i} className="cl-msg in" style={{ marginTop: 6 }}><div className="meta">{c.name} · {timeAgo(c.at)}</div>{c.text}</div>)}
            </div>
          )}
        </div>
      )}
      {p.opens && p.opens.length > 0 && (
        <div className="cl-sect"><h3>Opened</h3>{p.opens.slice(0, 8).map((v, i) => <div key={i} className="cl-row-sub">{new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>)}</div>
      )}
    </Drawer>
  );
}
