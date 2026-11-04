import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import SequenceEditor from '../components/SequenceEditor';
import { useToast } from '../context/ToastContext';
import { loadSequences, createSequence, updateSequence, type Sequence, type Variable } from '../lib/api';

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

  const load = useCallback(() => {
    loadSequences().then(r => { setSeqs(r.sequences); setVariables(r.variables); setError(null); }).catch(e => setError(e.message));
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
