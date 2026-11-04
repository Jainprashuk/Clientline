import { useEffect, useState } from 'react';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import {
  loadLead, saveOpener, approveLead, discardLead, restoreLead, writeLeadOpener,
  type DiscardReason, type Lead,
} from '../lib/api';
import { CONFIDENCE, DISCARD_LABEL, SOURCE_LABEL, STATUS_LABEL, fitClass, timeAgo } from '../lib/leads';

/**
 * One lead, in the order the prototype reads it: what they do, why now (every fact
 * with its source), why it fits you, who to write to, and the first line.
 * Approve / Discard (with a reason) / Undo in the footer.
 */
export default function LeadDrawer({ id, onClose, onChanged }: {
  id: string;
  onClose: () => void;
  /** After a decision or an edit, with the updated lead. */
  onChanged: (lead: Lead) => void;
}) {
  const toast = useToast();
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opener, setOpener] = useState('');
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState<DiscardReason | ''>('');

  useEffect(() => {
    setLead(null); setError(null);
    loadLead(id).then(l => { setLead(l); setOpener(l.opener || ''); }).catch(e => setError(e.message));
  }, [id]);

  const act = async (fn: () => Promise<Lead>, done: string) => {
    setBusy(true);
    try {
      const l = await fn();
      setLead(l); setOpener(l.opener || ''); onChanged(l);
      toast(done, 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const write = async () => {
    if (!lead) return;
    if (openerDirty && !window.confirm('Replace your unsaved edit with a new line?')) return;
    setWriting(true);
    try {
      const l = await writeLeadOpener(lead.id);
      setLead(l); setOpener(l.opener || ''); onChanged(l);
      if (!l.ok) toast(`No line could be written from these facts: ${l.writeError}`, 'info', 7000);
    } catch (e: any) { toast(e.message, 'error', 7000); }
    finally { setWriting(false); }
  };

  const openerDirty = !!lead && opener.trim() !== (lead.opener || '').trim();
  // A pasted message or HN post is its own first signal; repeating it adds nothing.
  const bare = (s: string) => s.replace(/[“”…"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const aboutAddsSomething = !!lead && !!lead.about && !lead.signals.some(s => bare(lead.about || '').startsWith(bare(s.text).slice(0, 80)));

  const footer = lead && (
    lead.status === 'new' || lead.status === 'held' ? (
      <>
        <button className="btn btn-primary" type="button" disabled={busy || lead.status === 'held'}
          title={lead.status === 'held' ? 'Find an email for them first' : 'Ready for outreach'}
          onClick={() => act(() => approveLead(lead.id), 'Approved — it will be ready for Outreach.')}>
          <i className="ti ti-check" /> Approve
        </button>
        <span className="spacer" />
        <select aria-label="Why discard" value={reason} onChange={e => setReason(e.target.value as DiscardReason)} style={{ maxWidth: 190 }}>
          <option value="">Discard because…</option>
          {Object.entries(DISCARD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-danger" type="button" disabled={busy || !reason}
          onClick={() => act(() => discardLead(lead.id, reason as DiscardReason), 'Discarded.')}>
          Discard
        </button>
      </>
    ) : (
      <>
        <span className="cl-hint" style={{ margin: 0 }}>
          {lead.status === 'approved' ? 'Approved. Sequences arrive with Outreach.' : `Discarded: ${DISCARD_LABEL[lead.discardReason as DiscardReason] || 'no reason'}`}
        </span>
        <span className="spacer" />
        <button className="btn" type="button" disabled={busy} onClick={() => act(() => restoreLead(lead.id), 'Moved back to review.')}>
          <i className="ti ti-arrow-back-up" /> Undo
        </button>
      </>
    )
  );

  return (
    <Drawer onClose={onClose} footer={footer}
      title={lead ? lead.name : 'Lead'}
      subtitle={lead ? [lead.person, lead.title].filter(Boolean).join(', ') || lead.where : undefined}>
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!lead && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {lead && (
        <>
          <div className="cl-sect">
            <div className="cl-meta">
              <span className="cl-source">{SOURCE_LABEL[lead.source]}</span>
              <span className={fitClass(lead.fit)} title="Fit">{lead.fit}<span className="cl-fit-bar"><i style={{ width: `${lead.fit}%` }} /></span></span>
              <span className={`badge ${lead.status === 'new' ? 'badge-new' : lead.status === 'approved' ? 'badge-sent' : lead.status === 'held' ? 'badge-pending' : 'badge-closed'}`}>{STATUS_LABEL[lead.status]}</span>
              {lead.postedAt && <span>· posted {timeAgo(lead.postedAt)}</span>}
            </div>
            {lead.where && <div className="cl-row-sub">{lead.where}</div>}
          </div>

          {aboutAddsSomething && (
            <div className="cl-sect">
              <h3>What they said</h3>
              <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 220, overflowY: 'auto' }}>{lead.about}</p>
            </div>
          )}

          <div className="cl-sect">
            <h3>Why now</h3>
            {lead.signals.map((s, i) => (
              <div className="cl-signal" key={i}>
                <div>{s.text}</div>
                <div className="src">
                  Source: {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.source} <i className="ti ti-external-link" /></a> : s.source}
                  {s.at ? ` · ${timeAgo(s.at)}` : ''}
                </div>
              </div>
            ))}
          </div>

          <div className="cl-sect">
            <h3>Why it fits you</h3>
            <ul className="cl-why" style={{ margin: 0, paddingLeft: 18 }}>
              {lead.fitWhy.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            {lead.budget && (
              <div className="cl-row-sub">Budget mentioned: {lead.budget.currency} {Math.round(lead.budget.amount).toLocaleString('en-IN')}{lead.budget.hourly ? ' an hour' : ''}</div>
            )}
          </div>

          <div className="cl-sect">
            <h3>Who to write to</h3>
            {lead.email ? (
              <div className="cl-meta">
                <strong style={{ color: 'var(--text)' }}>{lead.person || lead.name}</strong>
                <a href={`mailto:${lead.email}`}>{lead.email}</a>
                {lead.emailConfidence && (
                  <span className={`badge ${CONFIDENCE[lead.emailConfidence].cls}`} title={CONFIDENCE[lead.emailConfidence].tip}>{CONFIDENCE[lead.emailConfidence].label}</span>
                )}
              </div>
            ) : (
              <div className="cl-note">
                No email yet. {lead.postUrl ? <>You can reply where they posted: <a href={lead.postUrl} target="_blank" rel="noopener noreferrer">open the post</a>.</> : 'Nothing on their post or site gave one.'}
              </div>
            )}
          </div>

          <div className="cl-sect">
            <h3>Suggested first line</h3>
            <textarea className="cl-opener" aria-label="First line" maxLength={600} value={opener} disabled={writing}
              placeholder={writing ? 'Writing from the facts above…' : 'Write the first line of your email, or let AI draft one from the facts above.'}
              onChange={e => setOpener(e.target.value)} />
            {lead.openerState === 'written' && lead.openerSources && lead.openerSources.length > 0 && !openerDirty && (
              <div className="cl-row-sub">Built from: {lead.openerSources.join(' · ')}. Check each fact before sending.</div>
            )}
            {lead.openerState === 'failed' && !opener && (
              <div className="cl-note">No line was written: every draft used something that isn’t in the facts above, so none was kept. Write your own, or try again.</div>
            )}
            <div className="cl-meta" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" type="button" disabled={writing || busy} onClick={write}>
                {writing ? <><i className="ti ti-loader" /> Writing…</> : <><i className="ti ti-sparkles" /> {lead.opener ? 'Write again' : 'Write a first line'}</>}
              </button>
              {lead.openerState === 'edited' && !openerDirty && <span>Your edit.</span>}
              <span className="spacer" style={{ flex: 1 }} />
              {openerDirty && (
                <button className="btn btn-sm btn-primary" type="button" disabled={busy || writing}
                  onClick={() => act(() => saveOpener(lead.id, opener), 'First line saved.')}>Save line</button>
              )}
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}
