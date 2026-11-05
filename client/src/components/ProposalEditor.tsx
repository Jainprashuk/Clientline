import { useEffect, useState } from 'react';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import {
  deleteProposal, loadProposal, nudgeProposal, proposalMessage, proposalPreviewUrl, saveProposal, sendProposal,
  type Proposal,
} from '../lib/api';
import { money } from '../lib/money';
import { timeAgo } from '../lib/leads';

type Opt = { name: string; price: string; weeks: string; items: string; suggested: boolean };
const GAP = /\[[^\]\n]{1,60}\]/g;
const gapsOf = (s: string) => [...new Set(s.match(GAP) || [])];

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
    ? <span style={{ color: 'var(--green)' }}>Accepted by {p.acceptedBy.name} · {p.options[p.acceptedBy.option]?.name} · {timeAgo(p.acceptedBy.at)}</span>
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

      {gaps.length > 0 && !locked && (
        <div className="cl-note" style={{ marginBottom: 10 }}>Fill in before sending: {gaps.map(g => <span key={g} className="cl-gap" style={{ marginRight: 4 }}>{g}</span>)}</div>
      )}
      {p.draftedBy === 'ai' && !p.sentAt && <div className="cl-hint" style={{ marginTop: 0 }}>Drafted from the thread, your call notes and your profile. Check every line and price — it’s your offer.</div>}

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-group"><label className="form-label" htmlFor="pr-title">Title</label><input id="pr-title" type="text" maxLength={160} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="pr-intro">Intro, to them</label><textarea id="pr-intro" rows={3} maxLength={1500} value={f.intro} onChange={e => setF({ ...f, intro: e.target.value })} /></div>

        <div className="cl-cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {f.options.map((o, i) => (
            <div key={i} className="cl-row" style={{ borderColor: o.suggested ? 'var(--accent)' : undefined }}>
              <input type="text" aria-label={`Option ${i + 1} name`} value={o.name} maxLength={60} onChange={e => setOpt(i, { name: e.target.value })} style={{ fontWeight: 650 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input type="number" min={0} aria-label={`Option ${i + 1} price`} value={o.price} onChange={e => setOpt(i, { price: e.target.value })} />
                <input type="number" min={1} aria-label={`Option ${i + 1} weeks`} value={o.weeks} style={{ width: 70 }} onChange={e => setOpt(i, { weeks: e.target.value })} title="Weeks" />
              </div>
              <div className="cl-row-sub">{money(Number(o.price || 0) * 100, p.currency)} · {o.weeks} wk</div>
              <textarea rows={6} aria-label={`What option ${i + 1} includes`} value={o.items} placeholder="One line per thing included" style={{ marginTop: 6 }} onChange={e => setOpt(i, { items: e.target.value })} />
              <label className="cl-meta" style={{ marginTop: 6, cursor: 'pointer' }}>
                <input type="radio" name="suggested" checked={o.suggested} onChange={() => setOpt(i, { suggested: true })} /> Suggested
              </label>
            </div>
          ))}
        </div>

        <div className="cl-cols">
          <div className="form-group"><label className="form-label" htmlFor="pr-split">Payment split (%)</label><input id="pr-split" type="text" value={f.split} placeholder="30 / 40 / 30" onChange={e => setF({ ...f, split: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="pr-rounds">Rounds of changes</label><input id="pr-rounds" type="number" min={0} max={10} value={f.rounds} onChange={e => setF({ ...f, rounds: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="pr-valid">Open for (days)</label><input id="pr-valid" type="number" min={1} max={90} value={f.validDays} onChange={e => setF({ ...f, validDays: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label" htmlFor="pr-note">Anything else on terms (optional)</label><input id="pr-note" type="text" maxLength={600} value={f.note} placeholder="Hosting is billed to you directly" onChange={e => setF({ ...f, note: e.target.value })} /></div>
      </fieldset>
      {p.proof && <div className="cl-row-sub">Shows your work: <b>{p.proof.title}</b> — {p.proof.result}</div>}
      {p.opens && p.opens.length > 0 && (
        <div className="cl-sect"><h3>Opened</h3>{p.opens.slice(0, 8).map((v, i) => <div key={i} className="cl-row-sub">{new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>)}</div>
      )}
    </Drawer>
  );
}
