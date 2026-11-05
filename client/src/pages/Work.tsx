import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import ProjectDrawer, { HEALTH_COLOR } from '../components/ProjectDrawer';
import { loadProjects, type Project } from '../lib/api';
import { money } from '../lib/money';

const GROUPS: { key: string; title: string; hint: string; match: (p: Project) => boolean }[] = [
  { key: 'progress', title: 'In progress', hint: 'Being built', match: p => p.stage === 'progress' },
  { key: 'won', title: 'Not started', hint: 'Won — waiting for the deposit or your first step', match: p => p.stage === 'won' },
  { key: 'delivered', title: 'Delivered', hint: 'Handed over — waiting for the last payment', match: p => p.stage === 'delivered' },
  { key: 'paid', title: 'Paid', hint: 'Done in the last 30 days', match: p => p.stage === 'paid' },
];
const TONE: Record<string, string> = { late: 'var(--red)', wait: 'var(--text2)', todo: 'var(--amber)', later: 'var(--text3)', ok: 'var(--green)' };

/** Work you've won, while it happens: how far along, what's due, what's paid. */
export default function Work() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openId = params.get('p');
  const open = (id: string | null) => setParams(prev => { const n = new URLSearchParams(prev); if (id) n.set('p', id); else n.delete('p'); return n; });
  const load = useCallback(() => loadProjects().then(r => { setList(r.projects); setError(null); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const replace = (p: Project) => setList(l => l && l.map(x => (x.id === p.id ? p : x)));

  return (
    <Layout title="Projects" subtitle="Work you’ve won: a checklist from the proposal, payments as they come due, the target date, and progress updates to the client.">
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!list && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {list && !list.length && (
        <div className="s-card"><div className="empty-state"><i className="ti ti-checklist" />No projects yet. When a client accepts a proposal, the work shows up here with its checklist and payments.</div></div>
      )}
      {list && GROUPS.map(g => {
        const items = list.filter(g.match);
        if (!items.length) return null;
        return (
          <section key={g.key} style={{ marginBottom: 22 }}>
            <div className="cl-meta" style={{ marginBottom: 8 }}><b style={{ color: 'var(--text)', fontSize: 15 }}>{g.title}</b><span>· {items.length} · {g.hint}</span></div>
            <div className="cl-projects">
              {items.map(p => (
                <button key={p.id} type="button" className="cl-project" onClick={() => open(p.id)}>
                  <div className="cl-meta" style={{ justifyContent: 'space-between' }}>
                    <b style={{ color: 'var(--text)', fontSize: 14.5 }}>{p.name}</b>
                    <span style={{ color: HEALTH_COLOR[p.health.state], fontSize: 12, fontWeight: 600 }}>{p.health.label}</span>
                  </div>
                  <div className="cl-row-sub">{p.client}{p.proposal?.option ? ` · ${p.proposal.option}` : ''}</div>
                  <div className="progress-bar" style={{ margin: '10px 0 4px' }}><div className="progress-fill" style={{ width: `${p.health.pct}%` }} /></div>
                  <div className="cl-meta" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                    <span>{p.health.total ? `${p.health.done}/${p.health.total} done` : 'No checklist yet'}</span>
                    <span>{money(p.paid, p.currency)} of {money(p.value, p.currency)} paid</span>
                  </div>
                  {p.nextPayment && <div style={{ fontSize: 12, marginTop: 6, color: TONE[p.nextPayment.tone] }}><i className="ti ti-receipt" /> {p.nextPayment.text}</div>}
                  {p.project?.targetAt && p.stage !== 'paid' && <div className="cl-row-sub" style={{ marginTop: 2 }}>Target {new Date(p.project.targetAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {openId && <ProjectDrawer id={openId} onClose={() => { open(null); load(); }} onChanged={replace} />}
    </Layout>
  );
}
