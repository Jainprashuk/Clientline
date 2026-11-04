import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useToast } from '../context/ToastContext';
import {
  loadConnections, saveKey, removeKey, testKey, setShareOutreach,
  type Connections as ConnectionsView, type KeyView, type Provider,
} from '../lib/api';

// The key rows follow Outreach's AiKeysCard (Settings → AI keys): one numbered row per
// provider, a "How?" with the steps, and a status pill from the last real call.

interface Row { key: Provider; name: string; tag: string; required?: boolean; url: string; note: string; steps: string[] }

const AI: Row[] = [
  {
    key: 'groq', name: 'Groq', tag: 'Required for AI', required: true, url: 'https://console.groq.com/keys',
    note: 'Reads posts and writes first lines. Free, no card.',
    steps: ['Open the Groq console and sign up with Google or email.', 'Click “Create API Key” and give it any name.', 'Copy the key (it is shown only once) and paste it here.'],
  },
  {
    key: 'gemini', name: 'Google Gemini', tag: 'Optional backup', url: 'https://aistudio.google.com/apikey',
    note: 'Used when Groq is busy. Free, no card.',
    steps: ['Open Google AI Studio and sign in with any Google account.', 'Click “Create API key”.', 'Copy the key and paste it here.'],
  },
  {
    key: 'cerebras', name: 'Cerebras', tag: 'Optional backup', url: 'https://cloud.cerebras.ai',
    note: 'A last resort. Cerebras asks for a card to start its free trial credit.',
    steps: ['Open Cerebras Cloud and sign up.', 'Go to “API Keys” in the left menu and generate a key.', 'Copy the key and paste it here.'],
  },
];

const SEARCH: Row[] = [
  {
    key: 'tavily', name: 'Tavily', tag: 'For client posts', url: 'https://app.tavily.com',
    note: 'Finds recent posts from people looking for a freelancer. 1,000 free searches a month, no card.',
    steps: ['Open Tavily and sign up with Google or email.', 'Your API key is on the dashboard — copy it.', 'Paste it here.'],
  },
  {
    key: 'serpapi', name: 'SerpApi', tag: 'Optional backup', url: 'https://serpapi.com/manage-api-key',
    note: 'Used when Tavily is out for the month. 250 free searches a month.',
    steps: ['Open SerpApi and create a free account.', 'Open “API Key” in your dashboard and copy it.', 'Paste it here.'],
  },
];

const FREE_SOURCES = [
  { icon: 'ti-brand-ycombinator', name: 'Hacker News', note: 'The monthly “Freelancer? Seeking freelancer?” thread.' },
  { icon: 'ti-news', name: 'News feeds', note: 'Google News and GDELT, for companies that just raised money.' },
];

function StatusPill({ view }: { view: KeyView }) {
  if (!view.inUse) return <span className="sr-ml badge badge-pending">Not added</span>;
  const s = view.status;
  if (view.from === 'outreach' && !s) return <span className="sr-ml badge badge-sent" title="The key you saved in Outreach">From Outreach</span>;
  if (s?.state === 'invalid') return <span className="sr-ml badge badge-rejected" title={s.error || ''}>Rejected</span>;
  if (s?.state === 'quota') return <span className="sr-ml badge badge-pending" title={s.error || ''}>Limit reached</span>;
  return <span className="sr-ml badge badge-sent">Working</span>;
}

function KeyRows({ rows, views, locked, data, busy, onSave, onRemove, onTest }: {
  rows: Row[]; views: Record<string, KeyView>; locked: (p: Provider) => boolean; data: ConnectionsView;
  busy: string | null; onSave: (p: Provider, v: string) => Promise<boolean>; onRemove: (p: Provider) => void; onTest: (p: Provider) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const save = async (p: Provider) => {
    if (await onSave(p, values[p] || '')) setValues(v => ({ ...v, [p]: '' }));
  };
  return (
    <div className="sr-keylist">
      {rows.map((r, idx) => {
        const view = views[r.key];
        const off = locked(r.key) && !view.inUse;
        const used = (data.usage as any)[r.key] as number | undefined;
        const cap = (data.usage.caps as any)[r.key] as number | undefined;
        return (
          <div className="form-group sr-keyrow" key={r.key}>
            <label className="form-label sr-keyhead">
              <span className="sr-num" aria-hidden="true">{idx + 1}</span>
              <span className="sr-keyname">{r.name}</span>
              <span className={'sr-tag' + (r.required ? ' req' : '')}>{r.tag}</span>
              <StatusPill view={view} />
            </label>
            <div className="sr-keynote">
              {r.note}{' '}
              <a href={r.url} target="_blank" rel="noreferrer" className="sr-link">Get a free key <i className="ti ti-external-link" /></a>
              {' · '}
              <button type="button" className="btn-link sr-link sr-linkbtn" onClick={() => setOpen(open === r.key ? null : r.key)}>How?</button>
              {view.inUse && cap ? <> · {used ?? 0} of {cap} used here this month</> : null}
            </div>
            {open === r.key && <ol className="sr-steps">{r.steps.map(s => <li key={s}>{s}</li>)}</ol>}
            <div className="sr-keyinput">
              <input type="password" autoComplete="off" aria-label={`${r.name} API key`}
                value={values[r.key] || ''} onChange={e => setValues(v => ({ ...v, [r.key]: e.target.value }))}
                placeholder={off ? 'Add your Groq key first'
                  : view.saved ? `Saved (…${view.last4}). Paste a new one to replace it`
                  : view.from === 'outreach' ? `Using your Outreach key (…${view.last4}). Paste one to use a different key here`
                  : 'Paste the key'}
                disabled={off}
                onKeyDown={e => { if (e.key === 'Enter') save(r.key); }} />
              <button className="btn btn-primary" type="button" disabled={off || busy !== null || !(values[r.key] || '').trim()} onClick={() => save(r.key)}>
                {busy === r.key ? <><i className="ti ti-loader" /> Checking…</> : view.saved ? 'Replace' : 'Save'}
              </button>
              {view.inUse && <button className="btn" type="button" disabled={busy !== null} onClick={() => onTest(r.key)}>Test</button>}
              {view.saved && <button className="btn btn-danger" type="button" disabled={busy !== null} onClick={() => onRemove(r.key)}>Remove</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Connections() {
  const toast = useToast();
  const [data, setData] = useState<ConnectionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    loadConnections().then(setData).catch(e => setError(e.message));
  }, []);

  const onSave = async (p: Provider, value: string) => {
    if (!value.trim()) return false;
    setBusy(p);
    try {
      const next = await saveKey(p, value.trim());
      setData(next);
      if (next.warning) toast(next.warning, 'info', 7000);
      else toast('Key checked and saved.', 'success');
      return true;
    } catch (e: any) {
      toast(e.message, 'error', 7000);
      return false;
    } finally { setBusy(null); }
  };
  const onShare = async (on: boolean) => {
    setBusy('share');
    try { setData(await setShareOutreach(on)); toast(on ? 'Using your Outreach keys where none is added here.' : 'No longer using your Outreach keys.', 'success'); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };
  const onRemove = async (p: Provider) => {
    if (!window.confirm('Remove this key? Anything that needs it stops until you add one again.')) return;
    setBusy(p);
    try { setData(await removeKey(p)); toast('Key removed.', 'success'); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };
  const onTest = async (p: Provider) => {
    setBusy(p);
    try {
      const r = await testKey(p);
      setData(r);
      toast(r.ok ? 'The key works.' : `The test did not succeed: ${r.error}`, r.ok ? 'success' : 'error', 6000);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <Layout title="Free connections" subtitle="Your own free keys. Clientline runs every search and AI call on them, so nothing here costs you money.">
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!data && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {data && (
        <>
          {data.outreach.canShare && (
            <div className="s-card" style={{ marginBottom: 16 }}>
              <div className="s-head">
                <div className="s-head-left">
                  <div className="s-icon"><i className="ti ti-arrows-exchange" /></div>
                  <div>
                    <div className="s-title">Keys from Outreach</div>
                    <div className="s-sub">
                      {data.outreach.found.length
                        ? `You have ${data.outreach.found.length} key${data.outreach.found.length === 1 ? '' : 's'} in Outreach: ${data.outreach.found.join(', ')}`
                        : 'You have no keys saved in Outreach yet'}
                    </div>
                  </div>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={data.outreach.on} disabled={busy !== null} onChange={e => onShare(e.target.checked)} />
                  Use my Outreach keys
                </label>
              </div>
              <div className="s-body">
                <div className="sr-intro" style={{ margin: 0 }}>
                  Any connection without a key here uses the one you saved in Outreach, so you don’t add it twice. A key you add here always
                  takes over, and Clientline never changes anything in Outreach. Searches made here and in Outreach share the same free allowance.
                </div>
              </div>
            </div>
          )}

          <div className="s-card" style={{ marginBottom: 16 }}>
            <div className="s-head">
              <div className="s-head-left">
                <div className="s-icon"><i className="ti ti-sparkles" /></div>
                <div>
                  <div className="s-title">AI</div>
                  <div className="s-sub">{data.aiReady ? 'Groq added: first lines and post reading are on' : 'Add your free Groq key to turn AI on'}</div>
                </div>
              </div>
            </div>
            <div className="s-body">
              <div className="sr-intro">
                AI reads pasted chats and posts to tell clients from other freelancers, and writes a first line for each lead
                using only that lead’s facts and your profile. Leads are still found without it, just without first lines.
              </div>
              <KeyRows rows={AI} views={data.ai} data={data} busy={busy}
                locked={p => p !== 'groq' && !data.ai.groq.inUse}
                onSave={onSave} onRemove={onRemove} onTest={onTest} />
            </div>
          </div>

          <div className="s-card" style={{ marginBottom: 16 }}>
            <div className="s-head">
              <div className="s-head-left">
                <div className="s-icon"><i className="ti ti-search" /></div>
                <div>
                  <div className="s-title">Web search</div>
                  <div className="s-sub">{data.search.tavily.inUse || data.search.serpapi.inUse ? 'Client posts are on' : 'Optional: turns on the client posts source'}</div>
                </div>
              </div>
            </div>
            <div className="s-body">
              <KeyRows rows={SEARCH} views={data.search} data={data} busy={busy}
                locked={() => false} onSave={onSave} onRemove={onRemove} onTest={onTest} />
            </div>
          </div>

          <div className="s-card" style={{ marginBottom: 16 }}>
            <div className="s-head">
              <div className="s-head-left">
                <div className="s-icon"><i className="ti ti-world" /></div>
                <div>
                  <div className="s-title">No key needed</div>
                  <div className="s-sub">Public sources, always on</div>
                </div>
              </div>
            </div>
            <div className="s-body">
              {FREE_SOURCES.map(s => (
                <div key={s.name} className="sr-keyhead" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                  <i className={`ti ${s.icon}`} style={{ fontSize: 18, color: 'var(--text3)' }} />
                  <span><span className="sr-keyname">{s.name}</span><div className="sr-keynote" style={{ margin: 0 }}>{s.note}</div></span>
                  <span className="sr-ml badge badge-sent" style={{ marginLeft: 'auto' }}>Ready</span>
                </div>
              ))}
              <div className="sr-keyhead" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <i className="ti ti-brand-gmail" style={{ fontSize: 18, color: 'var(--text3)' }} />
                <span><span className="sr-keyname">Your Gmail</span><div className="sr-keynote" style={{ margin: 0 }}>Sends your outreach from your own address.</div></span>
                <span className="sr-ml badge badge-pending" style={{ marginLeft: 'auto' }}>Coming with Outreach</span>
              </div>
            </div>
          </div>

          <div className="info-box sr-note">
            <i className="ti ti-lock" style={{ fontSize: 15, flexShrink: 0 }} />
            <div>Each key is checked with one tiny request before saving, stored <strong>encrypted</strong>, and used only for your account.</div>
          </div>
        </>
      )}
    </Layout>
  );
}
