import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import SequenceEditor from '../components/SequenceEditor';
import { useToast } from '../context/ToastContext';
import { Link } from 'react-router-dom';
import {
  loadSequences, createSequence, updateSequence, loadDue, sendDueBatch, completeTask, loadConnections,
  type Sequence, type Variable, type DueSummary,
} from '../lib/api';

/** What's due now and the button that sends it, batch after batch, with progress. */
function DueCard({ due, gmail, onSent, onTaskDone }: {
  due: DueSummary; gmail: string | null; onSent: (d: DueSummary) => void; onTaskDone: (d: DueSummary) => void;
}) {
  const toast = useToast();
  const [sending, setSending] = useState<{ sent: number } | null>(null);
  const [report, setReport] = useState<{ sent: number; skipped: { name: string; reason: string }[]; stoppedBy: string | null } | null>(null);
  const total = due.first + due.followUps;
  const send = async () => {
    setSending({ sent: 0 }); setReport(null);
    let sent = 0; const skipped: { name: string; reason: string }[] = []; let stoppedBy: string | null = null; let last = due;
    try {
      for (let round = 0; round < 20; round++) {
        const r = await sendDueBatch();
        sent += r.sent; skipped.push(...r.skipped); last = r.due; stoppedBy = r.stoppedBy;
        setSending({ sent });
        if (!r.more || r.stoppedBy || r.sent === 0) break;
      }
    } catch (e: any) { stoppedBy = e.message; }
    setSending(null);
    setReport({ sent, skipped, stoppedBy });
    onSent(last);
    toast(sent ? `Sent ${sent} email${sent === 1 ? '' : 's'}.` : stoppedBy || 'Nothing could be sent.', sent ? 'success' : 'info', 6000);
  };
  const done = async (id: string) => {
    try { const r = await completeTask(id); onTaskDone(r.due); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div className="s-card" style={{ marginBottom: 16 }}>
      <div className="s-head">
        <div className="s-head-left">
          <div className="s-icon"><i className="ti ti-send" /></div>
          <div>
            <div className="s-title">{total ? `${total} email${total === 1 ? '' : 's'} due now` : 'Nothing due right now'}</div>
            <div className="s-sub">
              {total ? `${due.first} first email${due.first === 1 ? '' : 's'} · ${due.followUps} follow-up${due.followUps === 1 ? '' : 's'} · ` : ''}
              {due.sentToday} of {due.sendsPerDay} sent in the last 24 hours
              {due.inPausedSequences ? ` · ${due.inPausedSequences} waiting in paused sequences` : ''}
            </div>
          </div>
        </div>
        {gmail ? (
          <button className="btn btn-primary" type="button" disabled={!!sending || !total || !!due.pausedUntil} onClick={send}>
            {sending ? <><i className="ti ti-loader" /> Sending… {sending.sent}</> : <><i className="ti ti-send" /> Send due emails</>}
          </button>
        ) : <Link className="btn btn-primary" to="/connections">Connect Gmail</Link>}
      </div>
      {(report || due.pausedUntil || due.tasks.length > 0 || (gmail && total > 0)) && (
        <div className="s-body">
          {gmail && total > 0 && !report && <div className="cl-hint" style={{ marginTop: 0 }}>Sends from {gmail}. Replies are checked first, so nobody who answered gets a follow-up.</div>}
          {due.pausedUntil && <div className="cl-note">Gmail’s daily limit was reached. Sending waits until {new Date(due.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}; nothing is lost.</div>}
          {report && (
            <div className="cl-meta" style={{ marginBottom: 6 }}>
              <b>Sent {report.sent}</b>
              {report.skipped.length > 0 && <span>· Not sent: {report.skipped.slice(0, 4).map(s => `${s.name} (${s.reason})`).join(', ')}{report.skipped.length > 4 ? '…' : ''}</span>}
              {report.stoppedBy && <span style={{ color: 'var(--amber)' }}>· {report.stoppedBy}</span>}
            </div>
          )}
          {due.tasks.length > 0 && (
            <>
              <div className="form-label" style={{ margin: '8px 0 6px' }}>Tasks for you</div>
              {due.tasks.map(t => (
                <div key={t.enrollmentId} className="cl-meta" style={{ padding: '6px 0' }}>
                  <i className="ti ti-checkbox" /><span style={{ color: 'var(--text)' }}>{t.text}</span><span>— {t.lead} · {t.sequence}</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-sm" type="button" onClick={() => done(t.enrollmentId)}>Done</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One sequence, in the prototype's card: status, people, reply rate, and each step's numbers. */
function SequenceCard({ seq, onEdit, onToggle, busy }: { seq: Sequence; onEdit: () => void; onToggle: () => void; busy: boolean }) {
  const st = seq.stats;
  const firstSent = st ? st.sent['0'] || 0 : 0;
  const rate = firstSent ? Math.round(((st?.replied || 0) / firstSent) * 100) : 0;
  return (
    <div className="s-card" style={{ marginBottom: 14 }}>
      <div className="s-head">
        <div className="s-head-left">
          <div className="s-icon"><i className="ti ti-mail-forward" /></div>
          <div>
            <div className="s-title">{seq.name}</div>
            <div className="s-sub">
              {st ? `${st.people} ${st.people === 1 ? 'person' : 'people'} · ${st.active} in progress · ${st.replied} replied${firstSent ? ` (${rate}%)` : ''}` : '—'}
              {st && (st.bounced || st.unsubscribed) ? ` · ${st.bounced} bounced · ${st.unsubscribed} unsubscribed` : ''}
            </div>
          </div>
        </div>
        <div className="cl-meta">
          <span className={`badge ${seq.active ? 'badge-sent' : 'badge-pending'}`}>{seq.active ? 'Running' : 'Paused'}</span>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={onToggle}>{seq.active ? 'Pause' : 'Resume'}</button>
          <button className="btn btn-sm" type="button" onClick={onEdit}><i className="ti ti-pencil" /> Edit</button>
        </div>
      </div>
      <div className="s-body">
        {seq.steps.map((s, i) => (
          <div key={i} className="cl-meta" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--border)' : 0 }}>
            <span className="sr-num" aria-hidden="true">{i + 1}</span>
            <span style={{ width: 52 }}>Day {s.dayOffset}</span>
            <span className="cl-source">{s.kind === 'task' ? 'Task for you' : 'Email'}</span>
            <span style={{ color: 'var(--text)', flex: 1, minWidth: 0 }} className="cl-clamp">
              {s.kind === 'task' ? s.body : i === 0 ? s.subject : `Re: ${seq.steps[0].subject}`}
            </span>
            <span>{st ? `${st.sent[String(i)] || 0} ${s.kind === 'task' ? 'done' : 'sent'}` : ''}{st && s.kind === 'email' ? ` · ${st.repliedAt[String(i)] || 0} replied` : ''}</span>
          </div>
        ))}
        <div className="cl-hint">At most {seq.newPerDay} new people a day. Stops for anyone who replies, bounces or unsubscribes.</div>
      </div>
    </div>
  );
}

export default function Outreach() {
  const toast = useToast();
  const [seqs, setSeqs] = useState<Sequence[] | null>(null);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [due, setDue] = useState<DueSummary | null>(null);
  const [gmail, setGmail] = useState<string | null>(null);

  const load = useCallback(() => {
    loadSequences().then(r => { setSeqs(r.sequences); setVariables(r.variables); setError(null); }).catch(e => setError(e.message));
    loadDue().then(setDue).catch(() => {});
    loadConnections().then(c => setGmail(c.gmail.email || null)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (s: Sequence) => {
    setBusy(s.id);
    try { const u = await updateSequence(s.id, { active: !s.active }); setSeqs(list => list && list.map(x => (x.id === u.id ? u : x))); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };
  const create = async () => {
    const name = window.prompt('Name the new sequence', 'Follow-up for funded startups');
    if (name === null) return;
    try { const s = await createSequence(name); setSeqs(list => [...(list || []), s]); setEditing(s.id); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const editingSeq = seqs && editing ? seqs.find(s => s.id === editing) : null;
  return (
    <Layout title="Outreach" subtitle="Sequences send from your own Gmail, a few at a time, and stop for anyone who replies, bounces or unsubscribes."
      actions={<button className="btn" type="button" onClick={create}><i className="ti ti-plus" /> New sequence</button>}>
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!seqs && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {due && <DueCard due={due} gmail={gmail} onSent={d => { setDue(d); load(); }} onTaskDone={setDue} />}
      {seqs && seqs.map(s => (
        <SequenceCard key={s.id} seq={s} busy={busy === s.id} onEdit={() => setEditing(s.id)} onToggle={() => toggle(s)} />
      ))}
      {editingSeq && (
        <SequenceEditor seq={editingSeq} variables={variables} onClose={() => setEditing(null)}
          onSaved={u => setSeqs(list => list && list.map(x => (x.id === u.id ? u : x)))}
          onDeleted={id => { setSeqs(list => list && list.filter(x => x.id !== id)); setEditing(null); }} />
      )}
    </Layout>
  );
}
