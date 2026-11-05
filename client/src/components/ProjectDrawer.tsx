import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Drawer from './Drawer';
import InfoTip from './InfoTip';
import { useToast } from '../context/ToastContext';
import { changeProject, draftProjectUpdate, loadProject, projectPaymentInvoice, sendProjectUpdate, type Project } from '../lib/api';
import { money } from '../lib/money';
import { timeAgo } from '../lib/leads';

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const HEALTH_COLOR: Record<Project['health']['state'], string> = {
  ok: 'var(--green)', soon: 'var(--amber)', behind: 'var(--amber)', late: 'var(--red)', delivered: 'var(--green)', none: 'var(--text3)',
};

/**
 * One project: progress, checklist, payments as they come due, dates, links,
 * notes, and a progress update you send in the client's thread.
 */
export default function ProjectDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: (p: Project) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [p, setP] = useState<Project | null>(null);
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');
  const [link, setLink] = useState({ label: '', url: '' });
  const [update, setUpdate] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The suggested checklist while you review it: your edits stay here until you approve.
  const [review, setReview] = useState<{ text: string; keep: boolean; why: string }[] | null>(null);
  const [extra, setExtra] = useState('');
  useEffect(() => { setReview(p && p.suggestedChecklist ? p.suggestedChecklist.map(x => ({ ...x })) : null); }, [p?.id, !!p?.suggestedChecklist]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadProject(id).then(setP).catch(e => toast(e.message, 'error')); }, [id, toast]);
  const change = async (key: string, body: Record<string, unknown>, done?: string) => {
    setBusy(key);
    try { const x = await changeProject(id, body); setP(x); onChanged?.(x); if (done) toast(done, 'success'); return true; }
    catch (e: any) { toast(e.message, 'error'); return false; }
    finally { setBusy(null); }
  };
  if (!p) return <Drawer title="Project" onClose={onClose}><div className="empty-state"><i className="ti ti-loader" />Loading…</div></Drawer>;

  const pr = { ...p.project, tasks: p.project?.tasks || [], links: p.project?.links || [], notes: p.project?.notes || [], updates: p.project?.updates || [] };
  const h = p.health;
  return (
    <Drawer title={p.name} subtitle={<>{p.client}{p.proposal?.option ? ` · ${p.proposal.option}` : ''} · {money(p.value, p.currency)}</>} onClose={onClose} width={680}
      footer={(
        <div className="cl-meta" style={{ width: '100%', flexWrap: 'wrap' }}>
          <Link className="btn btn-sm" to={`/deals?d=${p.id}`}>Deal</Link>
          {p.conversationId && <Link className="btn btn-sm" to={`/inbox?c=${p.conversationId}`}><i className="ti ti-message" /> Thread</Link>}
          <span style={{ flex: 1 }} />
          {p.stage !== 'delivered' && p.stage !== 'paid' && (
            <button className="btn" type="button" disabled={!!busy} onClick={() => window.confirm('Mark it delivered? The final invoice comes next.') && change('stage', { stage: 'delivered' }, 'Marked delivered.')}>
              <i className="ti ti-package" /> Mark delivered
            </button>
          )}
          <button className="btn btn-primary" type="button" disabled={!!busy}
            onClick={async () => { setBusy('draft'); try { setUpdate((await draftProjectUpdate(id)).text); } catch (e: any) { toast(e.message, 'error', 8000); setUpdate(''); } finally { setBusy(null); } }}>
            {busy === 'draft' ? <><i className="ti ti-loader" /> Writing…</> : <><i className="ti ti-send" /> Update the client</>}
          </button>
        </div>
      )}>
      {update !== null && (
        <div className="cl-sect" style={{ background: 'var(--canvas)', borderRadius: 12, padding: 14, marginBottom: 12, border: '1px solid var(--border)' }}>
          <h3>Progress update to {p.email || p.client} <InfoTip text="Written from your checklist: what you’ve ticked off since your last update, what’s next, and the target date — it never claims anything you haven’t ticked. Edit it, then send; it goes from your Gmail in your thread with them." /></h3>
          <textarea rows={8} value={update} placeholder="What’s done, what’s next." onChange={e => setUpdate(e.target.value)} />
          <div className="cl-meta" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" type="button" onClick={() => setUpdate(null)}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" type="button" disabled={!!busy || !update.trim()}
              onClick={async () => { setBusy('send'); try { const x = await sendProjectUpdate(id, update); setP(x); onChanged?.(x); setUpdate(null); toast('Update sent from your Gmail.', 'success'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(null); } }}>
              {busy === 'send' ? 'Sending…' : 'Send from Gmail'}
            </button>
          </div>
        </div>
      )}

      <div className="cl-sect">
        <div className="cl-meta" style={{ justifyContent: 'space-between' }}>
          <b style={{ color: HEALTH_COLOR[h.state] }}>{h.label}</b>
          <span>{h.total ? `${h.done} of ${h.total} done` : 'No tasks yet'}</span>
        </div>
        <div className="progress-bar" style={{ marginTop: 8 }}><div className="progress-fill" style={{ width: `${h.pct}%` }} /></div>
        <div className="cl-cols" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="pj-start">Started <InfoTip text="When the work began — set to the day the first payment came in. Change it if you started earlier or later." /></label>
            <input id="pj-start" type="date" value={pr.startedAt ? pr.startedAt.slice(0, 10) : ''} onChange={e => change('dates', { dates: { startedAt: e.target.value ? `${e.target.value}T09:00:00` : null } })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pj-target">Target <InfoTip text={`When it should be delivered: the start date plus the ${p.proposal?.weeks ?? '…'} weeks you quoted. “Behind” means fewer tasks are done than the time gone by suggests.`} /></label>
            <input id="pj-target" type="date" value={pr.targetAt ? pr.targetAt.slice(0, 10) : ''} onChange={e => change('dates', { dates: { targetAt: e.target.value ? `${e.target.value}T18:00:00` : null } })} />
          </div>
        </div>
      </div>

      {review ? (
        <div className="cl-sect" style={{ background: 'var(--canvas)', borderRadius: 12, padding: 14, border: '1px solid var(--accent)' }}>
          <h3>Suggested checklist <InfoTip text="Made from what the client accepted in the proposal. Nothing is saved until you approve it: untick lines that aren’t real work steps, reword them, add your own." /></h3>
          <div className="cl-row-sub" style={{ marginBottom: 8 }}>From the accepted proposal{p.proposal?.option ? ` — ${p.proposal.option}` : ''}. Review it, then use it.</div>
          {review.map((r, i) => (
            <div key={i} className="cl-meta" style={{ padding: '4px 0', alignItems: 'center', opacity: r.keep ? 1 : 0.6 }}>
              <input type="checkbox" checked={r.keep} aria-label={`Keep ${r.text}`} onChange={e => setReview(rv => rv && rv.map((x, n) => (n === i ? { ...x, keep: e.target.checked } : x)))} />
              <input type="text" value={r.text} maxLength={300} style={{ flex: 1 }} onChange={e => setReview(rv => rv && rv.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)))} />
              {r.why && !r.keep && <span className="cl-row-sub" title={r.why}><i className="ti ti-info-circle" /> not a step?</span>}
            </div>
          ))}
          <form className="cl-meta" style={{ marginTop: 6 }} onSubmit={e => { e.preventDefault(); if (extra.trim()) { setReview(rv => [...(rv || []), { text: extra.trim(), keep: true, why: '' }]); setExtra(''); } }}>
            <input type="text" value={extra} maxLength={300} placeholder="Add a step — e.g. Set up staging site" onChange={e => setExtra(e.target.value)} />
            <button className="btn btn-sm" type="submit" disabled={!extra.trim()}>Add</button>
          </form>
          <div className="cl-meta" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => change('checklist', { checklist: { skip: true } }, 'Starting with an empty checklist.')}>Start empty</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" type="button" disabled={!!busy || !review.some(r => r.keep && r.text.trim())}
              onClick={() => change('checklist', { checklist: { tasks: review.filter(r => r.keep).map(r => r.text) } }, 'Checklist saved.')}>
              Use this checklist ({review.filter(r => r.keep && r.text.trim()).length})
            </button>
          </div>
        </div>
      ) : (
      <div className="cl-sect">
        <h3>Checklist <InfoTip text="Starts with what the client accepted in the proposal. Tick things off as you go and add your own steps — the progress bar and the client update are built from this." /></h3>
        {pr.tasks.map(t => (
          <div key={t.id} className="cl-meta" style={{ padding: '4px 0', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={t.done} disabled={!!busy} style={{ marginTop: 3 }} aria-label={t.text}
              onChange={e => change(`t-${t.id}`, { task: { id: t.id, done: e.target.checked } })} />
            <span style={{ flex: 1, color: t.done ? 'var(--text3)' : 'var(--text)', textDecoration: t.done ? 'line-through' : 'none' }}>
              {t.text}{t.done && t.doneAt ? <span className="cl-row-sub" style={{ textDecoration: 'none', marginLeft: 6 }}>· {timeAgo(t.doneAt)}</span> : null}
            </span>
            <button className="btn btn-xs" type="button" aria-label={`Remove ${t.text}`} onClick={() => change(`r-${t.id}`, { task: { id: t.id, remove: true } })}><i className="ti ti-x" /></button>
          </div>
        ))}
        <form className="cl-meta" style={{ marginTop: 6 }} onSubmit={async e => { e.preventDefault(); if (task.trim() && await change('task', { task: { text: task } })) setTask(''); }}>
          <input type="text" value={task} maxLength={300} placeholder="Add a step — e.g. Set up staging site" onChange={e => setTask(e.target.value)} />
          <button className="btn btn-sm" type="submit" disabled={!task.trim() || !!busy}>Add</button>
        </form>
      </div>
      )}

      <div className="cl-sect">
        <h3>Payments <InfoTip text="Your payment split, each part with its invoice. Create the next invoice when you reach that point (e.g. the halfway demo), then send it from the invoice." /></h3>
        {p.payments.map((x, i) => (
          <div key={i} className="cl-meta" style={{ padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 0 }}>
            <span style={{ flex: 1 }}><b style={{ color: 'var(--text)' }}>{x.label}</b> · {money(x.amount, x.currency)}</span>
            {x.invoice ? (
              <Link to={`/invoices?i=${x.invoice.id}`} className="cl-row-sub" style={{ color: x.invoice.status === 'paid' ? 'var(--green)' : x.invoice.overdue ? 'var(--red)' : undefined }}>
                {x.invoice.number} · {x.invoice.status === 'paid' ? `paid ${day(x.invoice.paidAt)}` : x.invoice.status === 'draft' ? 'draft — send it' : x.invoice.overdue ? 'overdue' : `sent, due ${day(x.invoice.dueAt)}`}
              </Link>
            ) : x.part != null ? (
              <button className="btn btn-xs" type="button" disabled={!!busy}
                onClick={async () => { try { const r = await projectPaymentInvoice(id, x.part!); navigate(`/invoices?i=${r.invoiceId}`); } catch (e: any) { toast(e.message, 'error'); } }}>
                Create invoice
              </button>
            ) : null}
          </div>
        ))}
        {!p.payments.length && <div className="cl-row-sub">No payments yet.</div>}
        <div className="cl-row-sub" style={{ marginTop: 6 }}>{money(p.paid, p.currency)} of {money(p.value, p.currency)} paid (before GST)</div>
      </div>

      <div className="cl-sect">
        <h3>Links <InfoTip text="Everything for this job in one place: repo, staging site, Figma, shared drive." /></h3>
        {pr.links.map((l, i) => (
          <div key={i} className="cl-meta" style={{ padding: '3px 0' }}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1 }}>{l.label}</a>
            <button className="btn btn-xs" type="button" aria-label={`Remove ${l.label}`} onClick={() => change(`l-${i}`, { link: { index: i, remove: true } })}><i className="ti ti-x" /></button>
          </div>
        ))}
        <form style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 6, marginTop: 6 }} onSubmit={async e => { e.preventDefault(); if (await change('link', { link })) setLink({ label: '', url: '' }); }}>
          <input type="text" value={link.label} maxLength={80} placeholder="Staging" onChange={e => setLink({ ...link, label: e.target.value })} />
          <input type="url" value={link.url} maxLength={500} placeholder="https://…" onChange={e => setLink({ ...link, url: e.target.value })} />
          <button className="btn btn-sm" type="submit" disabled={!link.url.trim() || !!busy}>Add</button>
        </form>
      </div>

      <div className="cl-sect">
        <h3>Notes <InfoTip text="A running log for yourself: decisions, what the client asked for on a call, logins you mustn’t forget. Not sent to anyone." /></h3>
        <form onSubmit={async e => { e.preventDefault(); if (note.trim() && await change('note', { note: { text: note } })) setNote(''); }}>
          <textarea rows={2} value={note} maxLength={2000} placeholder="Client wants the booking page in Hindi too — quote separately" onChange={e => setNote(e.target.value)} />
          <button className="btn btn-sm" type="submit" style={{ marginTop: 6 }} disabled={!note.trim() || !!busy}>Add note</button>
        </form>
        {[...pr.notes].reverse().map(n => (
          <div key={n.id} className="cl-msg in" style={{ marginTop: 8 }}>
            <div className="meta" style={{ display: 'flex', justifyContent: 'space-between' }}>{day(n.at)}<button className="btn btn-xs" type="button" aria-label="Remove note" onClick={() => change(`n-${n.id}`, { note: { id: n.id, remove: true } })}><i className="ti ti-x" /></button></div>
            {n.text}
          </div>
        ))}
      </div>

      {pr.updates.length > 0 && (
        <div className="cl-sect">
          <h3>Updates sent</h3>
          {[...pr.updates].reverse().map((u, i) => <div key={i} className="cl-msg out" style={{ marginLeft: 0 }}><div className="meta">{day(u.at)}</div>{u.text}</div>)}
        </div>
      )}
    </Drawer>
  );
}
