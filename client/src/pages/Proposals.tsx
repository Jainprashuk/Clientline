import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import ProposalEditor from '../components/ProposalEditor';
import { loadProposals, type Proposal } from '../lib/api';
import { money } from '../lib/money';
import { timeAgo } from '../lib/leads';

export const PROPOSAL_STATUS: Record<Proposal['status'], string> = { draft: 'Draft', sent: 'Sent', viewed: 'Opened', accepted: 'Accepted', declined: 'Declined' };

/** Every proposal, newest first: where each stands, and whether a nudge would help. */
export default function Proposals() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openId = params.get('p');
  const open = (id: string | null) => setParams(prev => { const n = new URLSearchParams(prev); if (id) n.set('p', id); else n.delete('p'); return n; });
  const load = useCallback(() => loadProposals().then(r => { setList(r.proposals); setError(null); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const value = (p: Proposal) => {
    const o = p.acceptedBy ? p.options[p.acceptedBy.option] : p.options.find(x => x.suggested) || p.options[0];
    return o ? money(o.price, p.currency) : '—';
  };

  return (
    <Layout title="Proposals" subtitle="Each proposal is a page your client opens from a link. You see when they read it; they accept on the same page. Start one from a deal.">
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!list && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {list && !list.length && (
        <div className="s-card"><div className="empty-state"><i className="ti ti-file-description" />No proposals yet. Open a deal and press <b>Write a proposal</b>.</div></div>
      )}
      {list && list.length > 0 && (
        <div className="s-card"><div className="s-body" style={{ padding: 0 }}>
          <table className="cl-table">
            <thead><tr><th>Proposal</th><th>Status</th><th>Value</th><th>Sent</th><th /></tr></thead>
            <tbody>
              {list.map(p => (
                <tr key={p.id} className="click" onClick={() => open(p.id)} style={{ cursor: 'pointer' }}>
                  <td><b>{p.title}</b><div className="cl-row-sub">{p.deal?.client || p.deal?.email}</div></td>
                  <td><span className={`badge ${p.status === 'accepted' ? 'badge-sent' : p.status === 'draft' ? 'badge-pending' : ''}`}>{p.expired ? 'Expired' : PROPOSAL_STATUS[p.status]}</span>{p.views ? <div className="cl-row-sub">opened {p.views}×</div> : null}</td>
                  <td>{value(p)}{p.acceptedBy ? <div className="cl-row-sub">{p.options[p.acceptedBy.option]?.name}</div> : null}</td>
                  <td>{p.sentAt ? timeAgo(p.sentAt) : '—'}</td>
                  <td>{p.nudge && <span className="cl-gap" title={p.nudge}>Nudge?</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {openId && <ProposalEditor id={openId} onClose={() => open(null)} onChanged={load} onDeleted={() => load()} />}
    </Layout>
  );
}
