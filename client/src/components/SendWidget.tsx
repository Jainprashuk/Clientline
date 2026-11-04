// The floating sending panel, after Outreach's SendJobWidget: bottom-right on every
// page while "Send due emails" works in the background (lib/outreach/runs.js), and
// for a few seconds after, with how it went. Hiding it doesn't stop the sending.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activeSendRun, stopSendRun, SEND_FINISHED_EVENT, SEND_STARTED_EVENT, type SendRun } from '../lib/api';

const LIVE_MS = 3000;
const IDLE_MS = 60_000;     // a run started elsewhere (another tab) still turns up
const DISMISS_MS = 10_000;  // how long a finished run stays on screen

const live = (r: SendRun) => r.status === 'queued' || r.status === 'running';

export default function SendWidget() {
  const navigate = useNavigate();
  const [run, setRun] = useState<SendRun | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const hidden = useRef<Set<string>>(new Set());
  const wasLive = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const { run: r } = await activeSendRun();
      if (!r || hidden.current.has(r.id)) { setRun(null); return; }
      setRun(r);
      if (live(r)) wasLive.current = r.id;
      else if (wasLive.current === r.id) {
        wasLive.current = null;
        window.dispatchEvent(new Event(SEND_FINISHED_EVENT));
        setTimeout(() => { hidden.current.add(r.id); setRun(cur => (cur && cur.id === r.id ? null : cur)); }, DISMISS_MS);
      }
    } catch { /* transient */ }
  }, []);

  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    const ms = run && live(run) ? LIVE_MS : IDLE_MS;
    const t = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, ms);
    return () => clearInterval(t);
  }, [run, poll]);
  useEffect(() => {
    const started = (e: Event) => {
      const r = (e as CustomEvent<SendRun | undefined>).detail;
      if (r) { setRun(r); wasLive.current = r.id; }
      setCollapsed(false);
      poll();
    };
    window.addEventListener(SEND_STARTED_EVENT, started);
    return () => window.removeEventListener(SEND_STARTED_EVENT, started);
  }, [poll]);

  if (!run) return null;
  const done = run.sent + run.skipped.length;
  const pct = run.total ? Math.min(100, Math.round((done / run.total) * 100)) : 0;
  const isLive = live(run);

  let title: React.ReactNode;
  if (run.status === 'queued') title = <><i className="ti ti-clock" /> Starting to send…</>;
  else if (run.status === 'running') title = <><i className="ti ti-circle-filled sjw-live-dot" /> {run.stopRequested ? 'Stopping…' : `Sending ${run.sent}/${run.total}`}</>;
  else if (run.status === 'stopped') title = <><i className="ti ti-player-stop" /> Stopped · {run.sent} sent</>;
  else if (run.status === 'failed') title = <><i className="ti ti-alert-triangle" /> Not sent</>;
  else title = <><i className="ti ti-circle-check" /> {run.sent} sent{run.skipped.length ? `, ${run.skipped.length} skipped` : ''}</>;

  const stop = async () => { try { await stopSendRun(run.id); poll(); } catch { /* transient */ } };
  const hide = () => { hidden.current.add(run.id); setRun(null); };

  return (
    <div id="send-job-widget">
      <div className="sjw-card">
        <div className="sjw-header">
          <span title={run.trigger === 'auto' ? 'Follow-ups sent on schedule' : 'Send due emails'}>{title}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {isLive && !run.stopRequested && <button className="btn btn-xs" type="button" onClick={stop} title="Stop after the email going now" aria-label="Stop sending"><i className="ti ti-player-stop" /></button>}
            <button className="btn btn-xs" type="button" onClick={() => navigate('/outreach')} title="Open Outreach" aria-label="Open Outreach"><i className="ti ti-external-link" /></button>
            <button className="btn btn-xs" type="button" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Show details' : 'Hide details'} aria-label={collapsed ? 'Show details' : 'Hide details'}><i className={`ti ${collapsed ? 'ti-plus' : 'ti-minus'}`} /></button>
            <button className="btn btn-xs" type="button" onClick={hide} title="Hide (sending continues)" aria-label="Hide (sending continues)"><i className="ti ti-x" /></button>
          </div>
        </div>
        {collapsed && isLive && <div className="sjw-min-progress">
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span>{run.sent}/{run.total}</span>
        </div>}
        <div className={`sjw-body${collapsed ? ' collapsed' : ''}`}>
          {isLive && <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>}
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
            {run.sent}/{run.total} sent{run.skipped.length ? ` · ${run.skipped.length} skipped` : ''}
            {isLive && run.sent === 0 ? ' · checking replies first…' : ''}
          </div>
          {isLive && <div className="sjw-next-send">Keeps going if you close this tab.</div>}
          {run.last && <div className="sjw-recipient" title={run.last.email}><i className="ti ti-user" /> Last: {run.last.name} <span>&lt;{run.last.email}&gt;</span></div>}
          {run.stoppedBy && <div className="sjw-recipient" title={run.stoppedBy} style={{ color: 'var(--amber)', whiteSpace: 'normal' }}><i className="ti ti-alert-triangle" /> {run.stoppedBy}</div>}
          {!isLive && run.skipped.length > 0 && <div className="sjw-recipient" style={{ whiteSpace: 'normal' }} title={run.skipped.map(s => `${s.name}: ${s.reason}`).join('\n')}>
            Not sent: {run.skipped.slice(0, 3).map(s => `${s.name} (${s.reason})`).join(', ')}{run.skipped.length > 3 ? '…' : ''}
          </div>}
        </div>
      </div>
    </div>
  );
}
