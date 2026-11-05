import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import InfoTip from '../components/InfoTip';
import { useSession } from '../context/SessionContext';
import { loadToday, type TodayData, type TodayItem } from '../lib/api';
import { totals } from '../lib/money';

const ICON: Record<string, string> = {
  changes: 'ti-message-2', accepted: 'ti-confetti', reply: 'ti-mail-opened', overdue: 'ti-alarm', late: 'ti-clock-exclamation',
  send: 'ti-send', remind: 'ti-bell', nudge: 'ti-hand-finger', followups: 'ti-mail-forward', behind: 'ti-clock', stale: 'ti-zzz',
  leads: 'ti-target-arrow', tasks: 'ti-checkbox',
};
const TONE: Record<TodayItem['tone'], string> = { urgent: 'var(--amber)', good: 'var(--green)', normal: 'var(--accent)' };

/** What needs you today, most urgent first, and the money at a glance. */
export default function Today() {
  const { user } = useSession();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadToday().then(setData).catch(e => setError(e.message)); }, []);
  const hour = new Date().getHours();
  const hello = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${user && user.name ? `, ${String(user.name).split(' ')[0]}` : ''}`;

  return (
    <Layout title="Today" subtitle={hello}>
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!data && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {data && (
        <>
          <div className="cl-stats">
            <div><span>In the pipeline <InfoTip text="The value of deals you’re talking about or have sent a proposal for." /></span><b>{totals(data.money.pipeline) || '—'}</b></div>
            <div><span>Won this month</span><b>{totals(data.money.won) || '—'}</b></div>
            <div><span>Waiting to be paid <InfoTip text="Invoices you’ve sent that aren’t marked paid yet, including GST." /></span><b>{totals(data.money.waiting) || '—'}</b></div>
            <div><span>Paid this month</span><b>{totals(data.money.paidMonth) || '—'}</b></div>
          </div>

          <div className="s-card">
            <div className="s-head"><div className="s-head-left"><div className="s-icon"><i className="ti ti-list-check" /></div>
              <div><div className="s-title">{data.items.length ? `${data.items.length} thing${data.items.length === 1 ? '' : 's'} for you` : 'Nothing needs you right now'}</div>
                <div className="s-sub">Most urgent first: changes asked and replies, then money, then the rest.</div></div></div></div>
            <div className="s-body" style={{ padding: 0 }}>
              {!data.items.length && <div className="empty-state" style={{ padding: 24 }}><i className="ti ti-sun" />All clear. A good time to <Link to="/leads">find new leads</Link>.</div>}
              {data.items.map((it, i) => (
                <Link key={i} to={it.to} className="cl-today-item">
                  <i className={`ti ${ICON[it.kind] || 'ti-point'}`} style={{ color: TONE[it.tone] }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="t">{it.title}</span>
                    {it.detail && <span className="d">{it.detail}</span>}
                  </span>
                  <i className="ti ti-chevron-right" style={{ color: 'var(--text3)' }} />
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
