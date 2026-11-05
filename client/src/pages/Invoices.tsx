import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import InvoiceEditor, { INVOICE_STATUS } from '../components/InvoiceEditor';
import { useToast } from '../context/ToastContext';
import { createInvoice, loadInvoices, type Invoice, type Money } from '../lib/api';
import { money, totals } from '../lib/money';

/** Every invoice: what's waiting, what's overdue, what came in this month. */
export default function Invoices() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ invoices: Invoice[]; waiting: Money; paidMonth: Money } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openId = params.get('i');
  const open = (id: string | null) => setParams(prev => { const n = new URLSearchParams(prev); if (id) n.set('i', id); else n.delete('i'); return n; });
  const load = useCallback(() => loadInvoices().then(d => { setData(d); setError(null); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const blank = async () => {
    try { const i = await createInvoice({ items: [{ text: 'Work', qty: 1, rate: 0 }] }); await load(); open(i.id); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const list = data ? data.invoices : [];

  return (
    <Layout title="Invoices" subtitle="Indian clients pay by UPI from a QR on the invoice — no gateway, no fees. Others get your bank or PayPal details. You mark it paid."
      actions={<button className="btn" type="button" onClick={blank}><i className="ti ti-plus" /> New invoice</button>}>
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!data && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {data && (
        <div className="cl-meta" style={{ marginBottom: 12 }}>
          <span><b style={{ color: 'var(--text)' }}>{totals(data.waiting) || '₹0'}</b> waiting</span>
          {list.some(i => i.overdue) && <span style={{ color: 'var(--amber)' }}>· {list.filter(i => i.overdue).length} overdue</span>}
          {totals(data.paidMonth) && <span>· {totals(data.paidMonth)} paid this month</span>}
        </div>
      )}
      {data && !list.length && (
        <div className="s-card"><div className="empty-state"><i className="ti ti-receipt" />No invoices yet. When a client accepts a proposal, the deposit invoice is drafted here for you to check and send.</div></div>
      )}
      {list.length > 0 && (
        <div className="s-card"><div className="s-body" style={{ padding: 0 }}>
          <table className="cl-table">
            <thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {list.map(i => (
                <tr key={i.id} onClick={() => open(i.id)}>
                  <td><b>{i.number}</b><div className="cl-row-sub">{i.kind === 'deposit' ? 'Deposit' : i.kind === 'final' ? 'Final payment' : i.kind === 'milestone' ? 'Milestone' : ''}{i.deal ? ` · ${i.deal.name}` : ''}</div></td>
                  <td>{i.client.name || i.client.email || '—'}</td>
                  <td>{money(i.total, i.currency)}</td>
                  <td style={i.overdue ? { color: 'var(--amber)' } : undefined}>{i.dueAt && !['paid', 'void'].includes(i.status) ? new Date(i.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}{i.overdue ? ' · overdue' : ''}</td>
                  <td><span className={`badge ${i.status === 'paid' ? 'badge-sent' : i.status === 'draft' ? 'badge-pending' : ''}`}>{INVOICE_STATUS[i.status]}</span>{i.reminder && <span className="cl-gap" style={{ marginLeft: 6 }} title={i.reminder}>Remind?</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {openId && <InvoiceEditor id={openId} onClose={() => { open(null); load(); }} onChanged={() => load()} />}
    </Layout>
  );
}
