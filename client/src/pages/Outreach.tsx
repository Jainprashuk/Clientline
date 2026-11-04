import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import SequenceEditor from '../components/SequenceEditor';
import { useToast } from '../context/ToastContext';
import { Link } from 'react-router-dom';
import {
  loadSequences, createSequence, updateSequence, loadDue, startSending, activeSendRun, SEND_STARTED_EVENT, SEND_FINISHED_EVENT, completeTask, loadConnections, editDueEmail, removeDueLead,
  type Sequence, type Variable, type DueSummary, type DueEmail,
} from '../lib/api';

/** One due email, opened: edit its wording, go back to the sequence's, or take the lead out. */
function DueEditor({ item, onSaved }: { item: DueEmail; onSaved: (d: DueSummary) => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(item.subject || '');
  const [body, setBody] = useState(item.body || '');
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = subject !== (item.subject || '') || body !== (item.body || '');
  const run = async (key: string, fn: () => Promise<DueSummary>, done: string) => {
    setBusy(key);
    try { onSaved(await fn()); toast(done, 'success'); } catch (e: any) { toast(e.message, 'error', 7000); } finally { setBusy(null); }
  };
  if (item.blocked) return <div className="cl-note" style={{ margin: '0 0 10px' }}>Won’t send: {item.blocked}. Fix the lead (e.g. its first line) or take it out of the sequence.</div>;
  return (
    <div className="cl-signal" style={{ margin: '0 0 10px' }}>
      <div className="src" style={{ marginBottom: 6 }}>To {item.email}{item.edited ? ' · your edited version' : ' · from the sequence'} — a personal unsubscribe line is added when it sends</div>
      {item.followUp
        ? <div className="cl-row-sub" style={{ margin: '0 0 6px' }}>Subject: {item.subject} (follow-ups stay in the same thread)</div>
        : <input type="text" aria-label="Subject" maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} style={{ marginBottom: 8 }} />}
      <textarea aria-label="Email" rows={9} maxLength={4000} value={body} onChange={e => setBody(e.target.value)} />
      <div className="cl-meta" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" type="button" disabled={!dirty || busy !== null}
          onClick={() => run('save', () => editDueEmail(item.enrollmentId, { subject, body }), 'Saved — this version is what goes out.')}>Save</button>
        {item.edited && <button className="btn btn-sm" type="button" disabled={busy !== null}
          onClick={() => run('reset', () => editDueEmail(item.enrollmentId, { reset: true }), 'Back to the sequence’s text.')}>Revert to sequence text</button>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-danger btn-sm" type="button" disabled={busy !== null}
          onClick={() => window.confirm(`Take ${item.name} out of “${item.sequence}”? Nothing more is sent to them; the lead goes back to Approved.`)
            && run('remove', () => removeDueLead(item.enrollmentId), 'Removed from the sequence.')}>Remove from sequence</button>
      </div>
    </div>
  );
}

/** What's due now: pick which to send (all by default), open one to edit it, then send. */
function DueCard({ due, gmail, onSent, onChanged }: {
  due: DueSummary; gmail: string | null; onSent: (d: DueSummary) => void; onChanged: (d: DueSummary) => void;
}) {
  const toast = useToast();
  // A send in the background (lib/outreach/runs.js); the floating panel shows its progress.
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Unticked rows are left out of this send; everything starts ticked.
  const [unticked, setUnticked] = useState<string[]>([]);
  const ids = due.items.map(i => i.enrollmentId);
  const picked = ids.filter(id => !unticked.includes(id));
  const total = due.first + due.followUps;
  const all = picked.length === ids.length && total <= ids.length;

  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  useEffect(() => {
    activeSendRun().then(r => setSending(!!r.run && ['queued', 'running'].includes(r.run.status))).catch(() => {});
    const started = () => setSending(true);
    const finished = () => { setSending(false); loadDue().then(d => onSentRef.current(d)).catch(() => {}); };
    window.addEventListener(SEND_STARTED_EVENT, started);
    window.addEventListener(SEND_FINISHED_EVENT, finished);
    return () => { window.removeEventListener(SEND_STARTED_EVENT, started); window.removeEventListener(SEND_FINISHED_EVENT, finished); };
  }, []);

  const send = async () => {
    setSending(true);
    try {
      const r = await startSending(all ? undefined : picked);
      setUnticked([]);
      window.dispatchEvent(new CustomEvent(SEND_STARTED_EVENT, { detail: r.run }));
      toast('Sending in the background — you can leave this page.', 'success', 5000);
    } catch (e: any) {
      setSending(false);
      toast(e.message, 'error', 6000);
      if (/Already sending/.test(e.message)) { setSending(true); window.dispatchEvent(new Event(SEND_STARTED_EVENT)); }
    }
  };
  const done = async (id: string) => {
    try { const r = await completeTask(id); onChanged(r.due); } catch (e: any) { toast(e.message, 'error'); }
  };
  const label = all ? 'Send due emails' : `Send selected (${picked.length})`;

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
          <button className="btn btn-primary" type="button" disabled={!!sending || !total || !picked.length || !!due.pausedUntil} onClick={send}>
            {sending ? <><i className="ti ti-loader" /> Sending…</> : <><i className="ti ti-send" /> {label}</>}
          </button>
        ) : <Link className="btn btn-primary" to="/connections">Connect Gmail</Link>}
      </div>
      {(due.pausedUntil || due.tasks.length > 0 || due.items.length > 0) && (
        <div className="s-body">
          {due.pausedUntil && <div className="cl-note">Gmail’s daily limit was reached. Sending waits until {new Date(due.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}; nothing is lost.</div>}
          {due.items.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label className="cl-meta" style={{ padding: '4px 2px 8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.length === ids.length} onChange={e => setUnticked(e.target.checked ? [] : ids)} />
                {picked.length === ids.length ? 'All selected' : `${picked.length} of ${ids.length} selected`} — open one to edit it before it goes
              </label>
              {due.items.map(it => (
                <div key={it.enrollmentId} style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="cl-due-line">
                    <input type="checkbox" aria-label={`Send to ${it.name}`} checked={!unticked.includes(it.enrollmentId)} disabled={!!it.blocked}
                      onChange={() => setUnticked(u => (u.includes(it.enrollmentId) ? u.filter(x => x !== it.enrollmentId) : [...u, it.enrollmentId]))} />
                    <button type="button" className="cl-due-row" aria-expanded={open === it.enrollmentId} onClick={() => setOpen(o => (o === it.enrollmentId ? null : it.enrollmentId))}>
                      <span className="cl-source">{it.followUp ? `Follow-up ${it.step - 1}` : 'First email'}</span>
                      <span className="who">{it.name}<small>{it.email}</small></span>
                      <span className="subj">{it.blocked ? <span style={{ color: 'var(--amber)' }}>Won’t send: {it.blocked}</span> : it.subject}{it.edited && <span className="cl-gap" style={{ marginLeft: 8 }}>Edited</span>}</span>
                      <span className="seq">{it.sequence} · step {it.step} of {it.steps}</span>
                      <i className={`ti ti-chevron-${open === it.enrollmentId ? 'up' : 'down'}`} />
                    </button>
                  </div>
                  {open === it.enrollmentId && <DueEditor key={`${it.enrollmentId}-${it.edited}-${it.body}`} item={it} onSaved={onChanged} />}
                </div>
              ))}
              {total > due.items.length && <div className="cl-hint">…and {total - due.items.length} more.</div>}
            </div>
          )}
          {gmail && total > 0 && <div className="cl-hint" style={{ marginTop: 0 }}>Sends from {gmail}. Replies are checked first, so nobody who answered gets a follow-up. Sending carries on in the background — the panel at the bottom right shows how far it got.</div>}
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
  const [missingYours, setMissingYours] = useState<{ key: string; label: string; where: string }[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [due, setDue] = useState<DueSummary | null>(null);
  const [gmail, setGmail] = useState<string | null>(null);

  const load = useCallback(() => {
    loadSequences().then(r => { setSeqs(r.sequences); setVariables(r.variables); setMissingYours(r.missingYours || []); setError(null); }).catch(e => setError(e.message));
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
      {missingYours.length > 0 && (
        <div className="info-box danger" style={{ marginBottom: 12 }}>
          <i className="ti ti-alert-triangle" />
          <div>
            Your emails use details about you that aren’t filled in, so no lead can be added yet:
            {missingYours.map(m => <div key={m.key}>· <b>{m.label}</b> — add it in {m.where.startsWith('My profile') ? <Link to="/profile">My profile</Link> : <Link to="/connections">{m.where}</Link>}</div>)}
          </div>
        </div>
      )}
      {due && <DueCard due={due} gmail={gmail} onSent={d => { setDue(d); load(); }} onChanged={d => { setDue(d); load(); }} />}
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
