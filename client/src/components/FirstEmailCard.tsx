import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { saveFirstEmail, writeFirstEmail, type Lead } from '../lib/api';

const words = (s: string) => (s.match(/\S+/g) || []).length;
const links = (s: string) => (s.match(/https?:\/\/\S+/g) || []).length;

/**
 * The lead's whole first email, exactly as it will be sent: their ask, one piece of
 * your work, how you'd start, a short-plan offer, your signature. Written by AI from
 * the facts above and your profile (lib/outreach/firstEmail.js); yours to edit.
 */
export default function FirstEmailCard({ lead, disabled, onLead }: { lead: Lead; disabled?: boolean; onLead: (l: Lead) => void }) {
  const toast = useToast();
  const e = lead.firstEmail && lead.firstEmail.state !== 'failed' ? lead.firstEmail : null;
  const [subject, setSubject] = useState(e ? e.subject : '');
  const [body, setBody] = useState(e ? e.body : '');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setSubject(e ? e.subject : ''); setBody(e ? e.body : ''); }, [lead.id, e?.subject, e?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!e && (subject.trim() !== e.subject || body.trim() !== e.body.trim());
  const help = lead.emailHelp;
  const otherCases = (help?.cases || []).filter(t => t !== e?.caseTitle);

  const write = async (useCase?: string) => {
    if (dirty && !window.confirm('Replace your unsaved edit with a new email?')) return;
    setBusy(useCase ? 'case' : 'write');
    try {
      const l = await writeFirstEmail(lead.id, useCase);
      onLead(l);
      if (!l.ok) toast(`No email could be written from these facts: ${l.writeError}`, 'info', 8000);
    } catch (err: any) { toast(err.message, 'error', 7000); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save');
    try { onLead(await saveFirstEmail(lead.id, { subject, body })); toast('Email saved.', 'success'); }
    catch (err: any) { toast(err.message, 'error', 7000); }
    finally { setBusy(null); }
  };

  const n = words(body); const l = links(body);
  return (
    <div className="cl-sect">
      <h3>First email</h3>
      {e ? (
        <>
          <input type="text" aria-label="Subject" value={subject} maxLength={160} disabled={!!busy || disabled}
            onChange={ev => setSubject(ev.target.value)} style={{ marginBottom: 8, fontWeight: 600 }} />
          <textarea className="cl-opener" aria-label="Email" value={body} maxLength={4000} disabled={!!busy || disabled}
            onChange={ev => setBody(ev.target.value)} style={{ minHeight: 280 }} />
          <div className="cl-meta" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <span title="Shown to the person as one short, plain note">{n} words{n > 170 ? ' — long' : ''}</span>
            <span>· {l === 0 ? 'no link' : l === 1 ? 'one link' : <b style={{ color: 'var(--amber)' }}>{l} links — one reads better</b>}</span>
            <span>· {e.caseTitle ? <>work: <b>{e.caseTitle}</b></> : 'no work cited'}</span>
            {e.shape === 'event' && <span>· news lead: congrats, never “you need”</span>}
            {e.state === 'edited' && !dirty && <span>· your edit</span>}
          </div>
          {e.state === 'written' && e.sources.length > 0 && !dirty && (
            <div className="cl-row-sub">Built from: {e.sources.join(' · ')}. Check each fact before sending.</div>
          )}
        </>
      ) : (
        <div className="cl-note" style={{ marginBottom: 8 }}>
          {lead.firstEmail && lead.firstEmail.state === 'failed'
            ? <>No email was kept: every draft broke a rule ({lead.firstEmail.error || 'used something not in the facts'}). Try again, or add more to your profile.</>
            : busy ? 'Writing from the facts above and your profile…'
            : 'No first email yet. It’s written from the facts above and your profile: what they need, one piece of your work that matches, how you’d start, and an offer to send a short plan.'}
        </div>
      )}

      {help && (help.missingCaseFor || help.strength.length > 0) && (
        <div className="cl-hint" style={{ marginTop: 8 }}>
          Make it stronger:{' '}
          {help.missingCaseFor && <>add a piece of work for “{help.missingCaseFor}”</>}
          {help.missingCaseFor && help.strength.length > 0 && '; '}
          {help.strength.length > 0 && <>{help.strength.join(', ').toLowerCase()}</>}
          {' '}in <Link to="/profile">My profile</Link>.
        </div>
      )}

      <div className="cl-meta" style={{ marginTop: 8 }}>
        <button className="btn btn-sm" type="button" disabled={!!busy || disabled} onClick={() => write()}>
          {busy === 'write' ? <><i className="ti ti-loader" /> Writing…</> : <><i className="ti ti-sparkles" /> {e ? 'Write again' : 'Write the first email'}</>}
        </button>
        {e && otherCases.length > 0 && (
          <select aria-label="Cite a different piece of work" value="" disabled={!!busy || disabled} style={{ width: 'auto', maxWidth: 220 }}
            onChange={ev => { if (ev.target.value) write(ev.target.value); }}>
            <option value="">{busy === 'case' ? 'Writing…' : 'Use a different piece of work…'}</option>
            {otherCases.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        {dirty && (
          <>
            <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => { setSubject(e!.subject); setBody(e!.body); }}>Undo edits</button>
            <button className="btn btn-sm btn-primary" type="button" disabled={!!busy || !subject.trim() || !body.trim()} onClick={save}>Save email</button>
          </>
        )}
      </div>
    </div>
  );
}
