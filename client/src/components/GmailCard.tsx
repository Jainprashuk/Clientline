import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { connectGmail, disconnectGmail, testGmail, saveGmailSettings, type Connections } from '../lib/api';

const STEPS = [
  'Open your Google Account → Security, and turn on 2-Step Verification if it is off.',
  'Open “App passwords” (search for it at the top of your Google Account).',
  'Create one named “Clientline” and copy the 16 letters it shows.',
  'Paste them below with your Gmail address.',
];

/** Gmail for outreach: connect (checked with Gmail first), or use the one saved in Outreach. */
export default function GmailCard({ data, onChange }: { data: Connections; onChange: (d: Connections) => void }) {
  const toast = useToast();
  const g = data.gmail;
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState(g.senderName);
  const [booking, setBooking] = useState(g.bookingUrl);
  const [perDay, setPerDay] = useState(String(g.sendsPerDay));
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  useEffect(() => { setName(g.senderName); setBooking(g.bookingUrl); setPerDay(String(g.sendsPerDay)); }, [g.senderName, g.bookingUrl, g.sendsPerDay]);

  const run = async (key: string, fn: () => Promise<Connections & { ok?: boolean; error?: string | null }>, done: string) => {
    setBusy(key);
    try {
      const d = await fn(); onChange(d);
      if (d.ok === false) toast(d.error || 'Gmail did not accept the login.', 'error', 7000); else toast(done, 'success');
      return true;
    } catch (e: any) { toast(e.message, 'error', 7000); return false; }
    finally { setBusy(null); }
  };
  const connect = async () => {
    if (await run('connect', () => connectGmail(email.trim(), pass, name.trim()), 'Gmail connected.')) { setPass(''); setShowForm(false); }
  };
  const settingsDirty = name !== g.senderName || booking !== g.bookingUrl || Number(perDay) !== g.sendsPerDay;
  const pct = Math.min(100, Math.round((g.sentToday / Math.max(1, g.sendsPerDay)) * 100));

  return (
    <div className="s-card" style={{ marginBottom: 16 }}>
      <div className="s-head">
        <div className="s-head-left">
          <div className="s-icon"><i className="ti ti-brand-gmail" /></div>
          <div>
            <div className="s-title">Gmail</div>
            <div className="s-sub">{g.email ? `Sending as ${g.email}${g.from === 'outreach' ? ' — the Gmail you connected in Outreach' : ''}` : 'Sends your outreach from your own address'}</div>
          </div>
        </div>
        {g.email && <span className="badge badge-sent">{g.from === 'outreach' ? 'From Outreach' : 'Connected'}</span>}
      </div>
      <div className="s-body">
        {g.email && (
          <>
            <div className="cl-meta" style={{ marginBottom: 12 }}>
              <span>{g.sentToday} of {g.sendsPerDay} emails sent in the last 24 hours</span>
              <span className="cl-fit-bar" style={{ width: 140 }}><i style={{ width: `${pct}%`, background: pct > 80 ? 'var(--amber)' : undefined }} /></span>
              {g.pausedUntil && <span className="badge badge-pending">Gmail’s daily limit reached — waits until {new Date(g.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            <div className="cl-meta" style={{ marginBottom: 16 }}>
              <button className="btn btn-sm" type="button" disabled={busy !== null} onClick={() => run('test', testGmail, 'Gmail accepts the login.')}>
                {busy === 'test' ? <><i className="ti ti-loader" /> Checking…</> : 'Test'}
              </button>
              {g.savedHere && <button className="btn btn-sm btn-danger" type="button" disabled={busy !== null}
                onClick={() => window.confirm('Disconnect this Gmail? Sending stops until one is connected.') && run('remove', disconnectGmail, 'Gmail disconnected.')}>Disconnect</button>}
              {!showForm && <button className="btn btn-sm" type="button" onClick={() => setShowForm(true)}>{g.from === 'outreach' ? 'Use a different Gmail here' : 'Change Gmail'}</button>}
            </div>
          </>
        )}

        {(!g.email || showForm) && (
          <div style={{ marginBottom: 16 }}>
            <div className="sr-intro" style={{ marginTop: 0 }}>
              Clientline sends through Gmail with an <strong>app password</strong> — a separate 16-letter password just for this, which you can revoke any time.
              Your normal Gmail password is never asked for.{' '}
              <button type="button" className="btn-link sr-link sr-linkbtn" onClick={() => setShowSteps(s => !s)}>How do I get one?</button>
            </div>
            {showSteps && <ol className="sr-steps">{STEPS.map(s => <li key={s}>{s}</li>)}</ol>}
            <div className="cl-cols">
              <div className="form-group"><label className="form-label" htmlFor="gm-email">Gmail address</label>
                <input id="gm-email" type="email" autoComplete="off" value={email} placeholder="you@gmail.com" onChange={e => setEmail(e.target.value)} /></div>
              <div className="form-group"><label className="form-label" htmlFor="gm-pass">App password</label>
                <input id="gm-pass" type="password" autoComplete="off" value={pass} placeholder="abcd efgh ijkl mnop" onChange={e => setPass(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') connect(); }} /></div>
            </div>
            <div className="cl-meta">
              <button className="btn btn-primary" type="button" disabled={busy !== null || !email.trim() || !pass.trim()} onClick={connect}>
                {busy === 'connect' ? <><i className="ti ti-loader" /> Checking with Gmail…</> : 'Connect Gmail'}
              </button>
              {showForm && <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>}
            </div>
          </div>
        )}

        <div className="form-label" style={{ marginBottom: 8 }}>Sending</div>
        <div className="cl-cols">
          <div className="form-group"><label className="form-label" htmlFor="gm-name">Name on your emails</label>
            <input id="gm-name" type="text" maxLength={80} value={name} placeholder="Prashuk Jain" onChange={e => setName(e.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="gm-book">Booking link (optional)</label>
            <input id="gm-book" type="url" maxLength={300} value={booking} placeholder="https://cal.com/you" onChange={e => setBooking(e.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="gm-day">Emails per day, at most</label>
            <input id="gm-day" type="number" min={1} max={300} value={perDay} onChange={e => setPerDay(e.target.value)} />
            <div className="cl-hint">Gmail allows about 500 a day; staying well under keeps your address out of spam.</div></div>
        </div>
        {settingsDirty && (
          <button className="btn btn-primary btn-sm" type="button" disabled={busy !== null}
            onClick={() => run('settings', () => saveGmailSettings({ senderName: name, bookingUrl: booking, sendsPerDay: Number(perDay) }), 'Saved.')}>Save</button>
        )}
      </div>
    </div>
  );
}
