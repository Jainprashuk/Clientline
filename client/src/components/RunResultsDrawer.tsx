import { useCallback, useEffect, useState } from 'react';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import { loadRunItems, addRunItem, runItemsXlsxUrl, type RunItems, type RunOutcome } from '../lib/api';
import { timeAgo } from '../lib/leads';

const OUTCOME: Record<RunOutcome, { label: string; cls: string }> = {
  lead: { label: 'Lead', cls: 'new' },
  held: { label: 'Lead, no email', cls: 'held' },
  added: { label: 'Added by you', cls: 'new' },
  updated: { label: 'Added to a lead', cls: 'held' },
  repeat: { label: 'Already had', cls: 'drop' },
  capped: { label: 'With others', cls: 'drop' },
  drop: { label: 'Skipped', cls: 'drop' },
};
const FILTERS: { key: RunOutcome | ''; label: string }[] = [
  { key: '', label: 'Everything' }, { key: 'lead', label: 'Leads' }, { key: 'held', label: 'No email' },
  { key: 'drop', label: 'Skipped' }, { key: 'repeat', label: 'Already had' }, { key: 'added', label: 'Added by you' },
];

/**
 * Everything one run read and what happened to each item, so "63 skipped" can be
 * checked — and a post the rules got wrong can be added with "This is a lead".
 */
export default function RunResultsDrawer({ runId, onClose, onAdded, onOpenLead }: {
  runId: string;
  onClose: () => void;
  onAdded: () => void;
  onOpenLead: (leadId: string) => void;
}) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<RunOutcome | ''>('');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RunItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    loadRunItems(runId, { outcome, reason, page }).then(d => { setData(d); setError(null); }).catch(e => setError(e.message));
  }, [runId, outcome, reason, page]);
  useEffect(() => { load(); }, [load]);

  const add = async (id: string) => {
    setBusy(id);
    try {
      const r = await addRunItem(id);
      toast(r.already ? 'You already had this lead.' : r.status === 'held' ? 'Added to No contact yet (it has no email).' : 'Added to your leads.', 'success');
      load(); onAdded();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  };

  const c = data?.counts;
  const run = data?.run;
  // What reached the profile check; a source may set aside the rest first (HN's full-time jobs).
  const checked = c ? Object.values(c.outcome).reduce((a, b) => a + (b || 0), 0) : 0;
  return (
    <Drawer width={720} onClose={onClose}
      title={run ? `${run.label}: everything it read` : 'Results'}
      subtitle={run ? `Run ${timeAgo(run.finishedAt || run.startedAt)} · ${run.read} read, ${checked} checked against your profile · kept ${data!.keptDays} days` : undefined}
      footer={data && data.total > 0 ? (
        <a className="btn btn-sm" href={runItemsXlsxUrl(runId, { outcome, reason })} download>
          <i className="ti ti-file-spreadsheet" /> Export {data.total} to Excel
        </a>
      ) : undefined}>
      {run && !run.logged && (
        <div className="info-box" style={{ marginBottom: 12 }}>
          <i className="ti ti-info-circle" style={{ fontSize: 15, flexShrink: 0 }} />
          <div>This run happened before results were saved, so there is nothing to show. Run {run.label} again from Find leads to see everything it reads.</div>
        </div>
      )}
      {run && run.logged && run.read > checked && (
        <div className="cl-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          The other {run.read - checked} {run.source === 'hn' ? 'posts were full-time jobs or freelancers offering work' : run.source === 'news' ? 'headlines weren’t about a company raising money' : 'results weren’t posts'}, so they were set aside before the check and aren’t listed.
        </div>
      )}
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {data && (
        <>
          <div className="cl-toggles" role="group" aria-label="Show" style={{ marginBottom: 10 }}>
            {FILTERS.filter(f => !f.key || (c?.outcome[f.key] ?? 0) > 0).map(f => (
              <button key={f.key} type="button" className="cl-toggle" aria-pressed={outcome === f.key && !reason}
                onClick={() => { setOutcome(f.key); setReason(''); setPage(1); }}>
                {f.label}{f.key ? ` · ${c?.outcome[f.key] ?? 0}` : ''}
              </button>
            ))}
          </div>
          {c && c.reasons.length > 0 && (outcome === '' || outcome === 'drop') && (
            <div className="cl-toggles" role="group" aria-label="Why skipped" style={{ marginBottom: 14 }}>
              {c.reasons.map(r => (
                <button key={r.reason} type="button" className="cl-toggle" aria-pressed={reason === r.reason}
                  onClick={() => { setOutcome('drop'); setReason(reason === r.reason ? '' : r.reason); setPage(1); }}>
                  {r.n} × {r.reason}
                </button>
              ))}
            </div>
          )}

          {!data.items.length && <div className="empty-state"><i className="ti ti-list-search" />Nothing here.</div>}
          {data.items.map(i => (
            <div key={i.id} className="cl-signal" style={{ marginBottom: 8 }}>
              <div className="cl-meta" style={{ marginBottom: 4 }}>
                <span className={`cl-verdict ${OUTCOME[i.outcome].cls}`}>{OUTCOME[i.outcome].label}{i.fit != null && (i.outcome === 'lead' || i.outcome === 'held' || i.outcome === 'added') ? ` · ${i.fit}` : ''}</span>
                {i.name && <strong style={{ color: 'var(--text)' }}>{i.name}</strong>}
                {i.reason && <span>— {i.reason}</span>}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{i.text || <span className="cl-row-sub">(no text)</span>}</div>
              <div className="cl-meta" style={{ marginTop: 6 }}>
                {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer">Open the original <i className="ti ti-external-link" /></a>}
                {i.email && <span>{i.email}</span>}
                <span style={{ flex: 1 }} />
                {i.outcome === 'drop' && (
                  <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => add(i.id)}>
                    {busy === i.id ? <><i className="ti ti-loader" /> Adding…</> : <><i className="ti ti-plus" /> This is a lead</>}
                  </button>
                )}
                {i.leadId && i.outcome !== 'drop' && i.outcome !== 'capped' && (
                  <button type="button" className="btn btn-sm" onClick={() => onOpenLead(i.leadId!)}>Open lead</button>
                )}
              </div>
            </div>
          ))}

          {data.pages > 1 && (
            <div className="lr-foot">
              <span>{data.total} results · page {data.page} of {data.pages}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <button className="btn btn-sm" type="button" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </span>
            </div>
          )}
        </>
      )}
      {!data && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
    </Drawer>
  );
}
