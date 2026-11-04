import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import HoverCard from '../components/HoverCard';
import LeadDrawer from '../components/LeadDrawer';
import PasteDrawer from '../components/PasteDrawer';
import RunResultsDrawer from '../components/RunResultsDrawer';
import AddToSequence from '../components/AddToSequence';
import { useToast } from '../context/ToastContext';
import {
  loadLeads, loadSources, runSource,
  type Lead, type LeadList, type LeadSource, type LeadStatus, type RunnableSource, type SourceRun, type SourcesView,
} from '../lib/api';
import { CONFIDENCE, SOURCE_LABEL, STATUS_LABEL, STATUS_NOTE, fitClass, timeAgo, whoLine } from '../lib/leads';

const TABS: LeadStatus[] = ['new', 'held', 'approved', 'in-sequence', 'replied', 'discarded'];
const SOURCES: LeadSource[] = ['paste', 'hn', 'news', 'web-post'];
const RUNNABLE: { source: RunnableSource; icon: string; note: string }[] = [
  { source: 'hn', icon: 'ti-brand-ycombinator', note: 'Contract roles and client posts from this month’s HN threads' },
  { source: 'news', icon: 'ti-news', note: 'Companies that just raised money, with a contact from their site' },
  { source: 'web-post', icon: 'ti-world-search', note: 'Recent posts asking for a freelancer, on your search key' },
];

/** "3 new · 12 skipped: 8 not your service, …" */
function runSummary(r: SourceRun) {
  const parts = [`${r.created} new`];
  if (r.held) parts.push(`${r.held} without email`);
  if (r.dropped) parts.push(`${r.dropped} skipped`);
  return parts.join(' · ');
}

function FindLeads({ sources, busy, onRun, onResults }: {
  sources: SourcesView | null; busy: RunnableSource | null; onRun: (s: RunnableSource) => void; onResults: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button className="btn btn-primary" type="button" aria-haspopup="menu" aria-expanded={open} disabled={!!busy} onClick={() => setOpen(o => !o)}>
        {busy ? <><i className="ti ti-loader" /> Finding…</> : <><i className="ti ti-search" /> Find leads <i className="ti ti-chevron-down" /></>}
      </button>
      {open && (
        <div className="cl-menu" role="menu">
          {RUNNABLE.map(r => {
            const st = sources?.sources.find(s => s.source === r.source);
            const last = st?.lastRun;
            return (
              <div key={r.source}>
              <button type="button" role="menuitem"
                onClick={() => {
                  setOpen(false);
                  // Not ready yet: take them to what fixes it rather than a dead button.
                  if (st?.needs && sources && !sources.profileComplete) navigate('/setup');
                  else if (st?.needs) navigate('/connections');
                  else onRun(r.source);
                }}>
                <i className={`ti ${r.icon}`} style={{ fontSize: 17, marginTop: 1 }} />
                <span>
                  {st?.label || SOURCE_LABEL[r.source]}
                  <small>{st?.needs || r.note}</small>
                  {last && !st?.needs && <small>Last run {timeAgo(last.finishedAt || last.startedAt)}: {last.status === 'failed' ? last.error : runSummary(last)}</small>}
                </span>
              </button>
              {last && last.read > 0 && last.logged && (
                <button type="button" role="menuitem" className="cl-menu-sub" onClick={() => { setOpen(false); onResults(last.id); }}>
                  <span><small>See everything the last {st?.label || SOURCE_LABEL[r.source]} run read →</small></span>
                </button>
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Leads() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<LeadStatus>('new');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [hideWeak, setHideWeak] = useState(true);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<LeadList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<SourcesView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [running, setRunning] = useState<RunnableSource | null>(null);
  const [lastRun, setLastRun] = useState<SourceRun | null>(null);
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // A selection belongs to one view of the list.
  useEffect(() => { setSelected([]); }, [status, source, query, page]);
  const selectable = status === 'new' || status === 'approved';
  const toggleSel = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  // Typing settles for a moment before it searches.
  useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setList(await loadLeads({ status, source, q: query, hideWeak: hideWeak && (status === 'new' || status === 'held'), page }));
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [status, source, query, hideWeak, page]);

  useEffect(() => { refresh(); }, [refresh]);
  const refreshSources = useCallback(() => loadSources().then(setSources).catch(() => {}), []);
  useEffect(() => { refreshSources(); }, [refreshSources]);
  // On arrival, show the newest run of the last day, so its results can be opened.
  useEffect(() => {
    if (lastRun || !sources) return;
    const recent = sources.sources.map(s => s.lastRun).filter((r): r is SourceRun => !!r && r.status !== 'running')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
    if (recent && Date.now() - new Date(recent.startedAt).getTime() < 24 * 3600 * 1000) setLastRun(recent);
  }, [sources, lastRun]);

  const run = async (s: RunnableSource) => {
    setRunning(s);
    try {
      const { run: r } = await runSource(s);
      setLastRun(r);
      if (r.status === 'failed') toast(r.error || 'That source did not answer.', 'error', 7000);
      else toast(`${r.label}: ${runSummary(r)}${r.status === 'partial' ? ' — the rest continues next run' : ''}.`, r.created ? 'success' : 'info', 6000);
      setStatus('new'); setPage(1);
      await Promise.all([refresh(), refreshSources()]);
    } catch (e: any) { toast(e.message, 'error', 7000); }
    finally { setRunning(null); }
  };

  const onChanged = (l: Lead) => {
    // A decision moves it to another tab; refresh the counts and this tab.
    if (list && list.leads.some(x => x.id === l.id && x.status !== l.status)) refresh();
    else setList(prev => prev && { ...prev, leads: prev.leads.map(x => (x.id === l.id ? { ...x, ...l } : x)) });
  };

  // Straight after setup: run the keyless sources once so the first visit has leads.
  const firstRun = useRef(false);
  useEffect(() => {
    if (params.get('first') !== '1' || firstRun.current || !sources || !sources.profileComplete) return;
    firstRun.current = true;
    setParams({}, { replace: true });
    (async () => {
      for (const s of ['hn', 'news', 'web-post'] as RunnableSource[]) {
        const st = sources.sources.find(x => x.source === s);
        if (st && !st.needs) await run(s);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, sources]);

  const profileMissing = sources && !sources.profileComplete;
  const counts = list?.counts;

  return (
    <Layout title="Leads" subtitle="People who need what you sell, found from free sources. Open one to see why it fits and who to write to."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" type="button" disabled={!!profileMissing} onClick={() => setPasting(true)}><i className="ti ti-clipboard-text" /> Paste a chat or post</button>
          <FindLeads sources={sources} busy={running} onRun={run} onResults={setResultsFor} />
        </div>
      }>
      {profileMissing && (
        <div className="s-card" style={{ marginBottom: 16 }}>
          <div className="s-head">
            <div className="s-head-left">
              <div className="s-icon"><i className="ti ti-rocket" /></div>
              <div>
                <div className="s-title">Tell us what you do — 30 seconds</div>
                <div className="s-sub">Three quick picks (your services, smallest project, where clients can be) and your first leads arrive.</div>
              </div>
            </div>
            <Link className="btn btn-primary" to="/setup">Set up <i className="ti ti-arrow-right" /></Link>
          </div>
        </div>
      )}

      {sources && sources.profileComplete && !sources.aiReady && (
        <div className="info-box" style={{ marginBottom: 14 }}>
          <i className="ti ti-sparkles" style={{ fontSize: 15, flexShrink: 0 }} />
          <div>Leads are found without AI, but first lines need a free Groq key. Add one in <Link to="/connections">Free connections</Link> (or in Outreach — Clientline uses it too).</div>
        </div>
      )}

      {lastRun && lastRun.read > 0 && (
        <div className="cl-runs" aria-live="polite">
          <span className="cl-run"><b>{lastRun.label}</b> {runSummary(lastRun)} · {timeAgo(lastRun.finishedAt || lastRun.startedAt)}</span>
          {lastRun.reasons.slice(0, 3).map(r => <span className="cl-run" key={r.reason}>{r.n} × {r.reason}</span>)}
          {lastRun.logged && <button type="button" className="btn btn-xs" onClick={() => setResultsFor(lastRun.id)}><i className="ti ti-list-search" /> See all results</button>}
          <button type="button" className="btn btn-xs" aria-label="Hide" onClick={() => setLastRun(null)}><i className="ti ti-x" /></button>
        </div>
      )}

      <nav className="lr-cards" aria-label="Lead views">
        {TABS.map(t => (
          <button key={t} type="button" className={`lr-card${status === t ? ' on' : ''}`} aria-pressed={status === t}
            onClick={() => { setStatus(t); setPage(1); }}>
            <span className="lr-card-label">{STATUS_LABEL[t]}</span>
            <span className="lr-card-row">
              <span className="lr-card-count">{counts ? counts[t] : '–'}</span>
              <span className="lr-card-note" style={{ color: 'var(--text3)' }}>{STATUS_NOTE[t]}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="filter-row lr-filters" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label className="lr-search">
          <i className="ti ti-search" />
          <input type="search" aria-label="Search leads" placeholder="Search name, email or text" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div className="cl-toggles" role="group" aria-label="Source">
          <button type="button" className="cl-toggle" aria-pressed={source === ''} onClick={() => { setSource(''); setPage(1); }}>All sources</button>
          {SOURCES.map(s => (
            <button key={s} type="button" className="cl-toggle" aria-pressed={source === s} onClick={() => { setSource(s); setPage(1); }}>{SOURCE_LABEL[s]}</button>
          ))}
        </div>
        {(status === 'new' || status === 'held') && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginLeft: 'auto' }}>
            <input type="checkbox" checked={hideWeak} onChange={e => { setHideWeak(e.target.checked); setPage(1); }} />
            Hide weak fits{list && list.weakHidden ? ` (${list.weakHidden})` : ''}
          </label>
        )}
      </div>

      <div className={`table-card lr-table cl-table${loading ? ' refreshing-wrap is-refreshing' : ''}`}>
        <table>
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 34 }}>
                  <input type="checkbox" aria-label="Select all on this page"
                    checked={!!list && list.leads.length > 0 && selected.length === list.leads.length}
                    onChange={e => setSelected(e.target.checked && list ? list.leads.map(l => l.id) : [])} />
                </th>
              )}
              <th>Fit</th><th>Who</th><th>{status === 'in-sequence' || status === 'replied' ? 'Outreach' : 'Why now'}</th><th>Source</th><th>Email</th><th>Found</th>
            </tr>
          </thead>
          <tbody>
            {error && <tr><td colSpan={selectable ? 7 : 6}><div className="empty-state"><i className="ti ti-alert-triangle" />{error}</div></td></tr>}
            {!error && list && !list.leads.length && (
              <tr><td colSpan={selectable ? 7 : 6}><div className="empty-state">
                <i className="ti ti-target-arrow" />
                {query || source ? 'No leads match. Clear the search or pick All sources.'
                  : status === 'new' ? <>No leads to review yet. Use <b>Find leads</b> or paste a chat export.</>
                  : status === 'held' ? 'Nothing waiting for an email.'
                  : status === 'approved' ? 'Nothing approved yet.'
                  : status === 'in-sequence' ? 'Nobody in a sequence yet. Open a lead and use Add to sequence.'
                  : status === 'replied' ? 'No replies yet.' : 'Nothing discarded.'}
              </div></td></tr>
            )}
            {list && list.leads.map(l => (
              <tr key={l.id} tabIndex={0} onClick={() => setOpenId(l.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(l.id); }}>
                {selectable && (
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.includes(l.id)} onChange={() => toggleSel(l.id)} />
                  </td>
                )}
                <td>
                  <HoverCard align="left" width={300} trigger={
                    <span className={fitClass(l.fit)}>{l.fit}<span className="cl-fit-bar"><i style={{ width: `${l.fit}%` }} /></span></span>
                  }>
                    <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{l.fitWhy.map((w, i) => <div key={i}>{w}</div>)}</div>
                  </HoverCard>
                </td>
                <td style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 600 }}>{l.name}</div>
                  <div className="cl-row-sub">{whoLine(l)}</div>
                </td>
                <td style={{ maxWidth: 380, whiteSpace: 'normal' }}>
                  {l.outreach ? (
                    <div style={{ fontSize: 13 }}>
                      <b>{l.outreach.sequence}</b>
                      <div className="cl-row-sub">
                        {l.outreach.status === 'active'
                          ? `Step ${Math.min(l.outreach.step + 1, l.outreach.steps)} of ${l.outreach.steps} · ${new Date(l.outreach.nextAt) <= new Date() ? 'due now' : `next ${new Date(l.outreach.nextAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}`
                          : l.outreach.status === 'done' ? 'All emails sent' : `Stopped — ${l.outreach.stopReason}`}
                      </div>
                    </div>
                  ) : <div className="cl-clamp" style={{ fontSize: 13 }}>{(l.signals[0] || {}).text || l.heldReason}</div>}
                </td>
                <td><span className="cl-source">{SOURCE_LABEL[l.source]}</span></td>
                <td>
                  {l.email && l.emailConfidence
                    ? <span className={`badge ${CONFIDENCE[l.emailConfidence].cls}`} title={`${l.email} — ${CONFIDENCE[l.emailConfidence].tip}`}>{CONFIDENCE[l.emailConfidence].label}</span>
                    : <span className="cl-row-sub" style={{ margin: 0 }}>None yet</span>}
                </td>
                <td style={{ color: 'var(--text3)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{timeAgo(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectable && selected.length > 0 && (
        <div className="cl-runs" style={{ position: 'sticky', bottom: 12, background: 'var(--bg)', padding: 10, borderRadius: 12, boxShadow: 'var(--shadow-md)', marginTop: 12, alignItems: 'center' }}>
          <b>{selected.length} selected</b>
          <AddToSequence leadIds={selected} onAdded={(a) => { setSelected(s => s.filter(id => !a.includes(id))); refresh(); }} />
          <button className="btn btn-sm" type="button" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {list && list.pages > 1 && (
        <div className="lr-foot">
          <span>{list.total} leads · page {list.page} of {list.pages}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button className="btn btn-sm" type="button" disabled={page >= list.pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </span>
        </div>
      )}

      {openId && <LeadDrawer id={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
      {resultsFor && (
        <RunResultsDrawer runId={resultsFor} onClose={() => setResultsFor(null)}
          onAdded={() => { refresh(); }}
          onOpenLead={(id) => { setResultsFor(null); setOpenId(id); }} />
      )}
      {pasting && (
        <PasteDrawer onClose={() => setPasting(false)} onImported={(r) => {
          setPasting(false); setLastRun(r); setStatus('new'); setPage(1); refresh(); refreshSources();
        }} />
      )}
    </Layout>
  );
}
