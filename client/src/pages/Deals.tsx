import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import Drawer from '../components/Drawer';
import DealDrawer, { STAGE_LABEL } from '../components/DealDrawer';
import { useToast } from '../context/ToastContext';
import { loadDeals, startDeal, updateDeal, type Currency, type Deal, type DealStage } from '../lib/api';
import { money, totals } from '../lib/money';
import { timeAgo } from '../lib/leads';

const BOARD: DealStage[] = ['talking', 'call', 'proposal', 'won', 'progress', 'delivered', 'paid'];

function NewDeal({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Deal) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', client: '', email: '', value: '', currency: 'INR' as Currency });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { const d = await startDeal({ ...f, value: Number(f.value || 0) }); onCreated(d); onClose(); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Drawer title="New deal" subtitle="For work that came another way — a referral, a call. Deals from a reply start from Inbox." onClose={onClose}
      footer={<div className="cl-meta" style={{ width: '100%' }}><span style={{ flex: 1 }} /><button className="btn btn-primary" type="button" disabled={busy || !f.name.trim()} onClick={create}>Start the deal</button></div>}>
      <div className="form-group"><label className="form-label" htmlFor="nd-name">What’s the work?</label><input id="nd-name" type="text" maxLength={120} value={f.name} placeholder="Checkout rebuild" onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="cl-cols">
        <div className="form-group"><label className="form-label" htmlFor="nd-client">Client</label><input id="nd-client" type="text" maxLength={120} value={f.client} onChange={e => setF({ ...f, client: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="nd-email">Their email</label><input id="nd-email" type="email" maxLength={200} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="nd-value">Value (optional)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select aria-label="Currency" value={f.currency} style={{ width: 82 }} onChange={e => setF({ ...f, currency: e.target.value as Currency })}>
            {['INR', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input id="nd-value" type="number" min={0} value={f.value} onChange={e => setF({ ...f, value: e.target.value })} />
        </div>
      </div>
    </Drawer>
  );
}

/** The pipeline: drag a card to move it (or use the stage list in the deal on a phone). */
export default function Deals() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DealStage | null>(null);
  const openId = params.get('d');
  const open = (id: string | null) => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('d', id); else n.delete('d'); return n; });

  const load = useCallback(() => loadDeals().then(r => { setDeals(r.deals); setError(null); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const replace = (d: Deal) => setDeals(list => (list ? (list.some(x => x.id === d.id) ? list.map(x => (x.id === d.id ? d : x)) : [d, ...list]) : [d]));
  const move = async (id: string, stage: DealStage) => {
    const d = deals?.find(x => x.id === id);
    if (!d || d.stage === stage) return;
    replace({ ...d, stage });
    try { replace(await updateDeal(id, { stage })); }
    catch (e: any) { replace(d); toast(e.message, 'error'); }
  };

  const byStage = (s: DealStage) => (deals || []).filter(d => d.stage === s);
  const sum = (list: Deal[]) => {
    const t: Partial<Record<Currency, number>> = {};
    for (const d of list) t[d.currency] = (t[d.currency] || 0) + d.value;
    return totals(t);
  };
  const openDeals = (deals || []).filter(d => !['paid', 'lost'].includes(d.stage));
  const lost = byStage('lost');

  return (
    <Layout title="Deals" subtitle="Every conversation that could become work, from first reply to paid. Drag a card to move it."
      actions={<button className="btn btn-primary" type="button" onClick={() => setCreating(true)}><i className="ti ti-plus" /> New deal</button>}>
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!deals && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {deals && (
        <>
          <div className="cl-meta" style={{ marginBottom: 12 }}>
            <span><b style={{ color: 'var(--text)' }}>{sum(openDeals) || '—'}</b> in {openDeals.length} open deal{openDeals.length === 1 ? '' : 's'}</span>
            {byStage('paid').length > 0 && <span>· {sum(byStage('paid'))} paid</span>}
            <span style={{ flex: 1 }} />
            {lost.length > 0 && <button className="btn btn-sm" type="button" onClick={() => setShowLost(v => !v)}>{showLost ? 'Hide' : 'Show'} lost ({lost.length})</button>}
          </div>
          {!deals.length ? (
            <div className="s-card"><div className="empty-state">
              <i className="ti ti-layout-kanban" />
              No deals yet. When someone replies wanting a quote or a call, press <b>Start a deal</b> in Inbox — or add one here for work that came another way.
            </div></div>
          ) : (
            <div className="cl-board">
              {[...BOARD, ...(showLost ? ['lost' as DealStage] : [])].map(stage => {
                const list = byStage(stage);
                return (
                  <section key={stage} className={`cl-col${over === stage ? ' over' : ''}`} aria-label={STAGE_LABEL[stage]}
                    onDragOver={e => { if (dragging) { e.preventDefault(); setOver(stage); } }}
                    onDragLeave={() => setOver(o => (o === stage ? null : o))}
                    onDrop={e => { e.preventDefault(); setOver(null); if (dragging) move(dragging, stage); setDragging(null); }}>
                    <div className="cl-col-head"><b>{STAGE_LABEL[stage]}</b><span>{list.length ? sum(list) || list.length : ''}</span></div>
                    {list.map(d => (
                      <button key={d.id} type="button" className="cl-deal" draggable
                        onDragStart={e => { setDragging(d.id); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}
                        onClick={() => open(d.id)}>
                        <div className="v">{d.value ? money(d.value, d.currency) : <span className="cl-row-sub">No value yet</span>}</div>
                        <div className="n">{d.name}</div>
                        <div className="cl-row-sub">{d.client}</div>
                        {d.next && <div className="nx"><i className="ti ti-arrow-right" /> {d.next}</div>}
                        <div className="cl-row-sub" style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          {d.flags.length > 0 && <span style={{ color: 'var(--amber)' }}><i className="ti ti-flag" /> {d.flags.length}</span>}
                          <span>{timeAgo(d.lastActivityAt)}</span>
                        </div>
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      {creating && <NewDeal onClose={() => setCreating(false)} onCreated={d => { replace(d); open(d.id); }} />}
      {openId && <DealDrawer id={openId} onClose={() => open(null)} onChanged={replace} onDeleted={id => setDeals(l => l && l.filter(x => x.id !== id))} />}
    </Layout>
  );
}
