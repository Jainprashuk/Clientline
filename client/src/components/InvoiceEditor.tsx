import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import {
  invoiceMessage, invoicePreviewUrl, loadInvoice, markInvoicePaid, remindInvoice, saveInvoice, sendInvoice, voidInvoice,
  type Invoice,
} from '../lib/api';
import { money } from '../lib/money';
import { timeAgo } from '../lib/leads';

type Line = { text: string; qty: string; rate: string };
const toForm = (i: Invoice) => ({
  lines: i.items.map(it => ({ text: it.text, qty: String(it.qty), rate: String(it.rate / 100) })) as Line[],
  name: i.client.name, email: i.client.email, address: i.client.address, taxId: i.client.taxId,
  note: i.note, gst: String(i.gstPercent), due: i.dueAt ? i.dueAt.slice(0, 10) : '',
});

export const INVOICE_STATUS: Record<Invoice['status'], string> = { draft: 'Draft', sent: 'Sent', viewed: 'Opened', paid: 'Paid', void: 'Cancelled' };

/**
 * One invoice: lines, the client, GST, due date. Preview what the client sees,
 * send the link from your Gmail, remind when it's due, mark it paid.
 */
export default function InvoiceEditor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: (i: Invoice) => void }) {
  const toast = useToast();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [f, setF] = useState<ReturnType<typeof toForm> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ kind: 'send' | 'remind'; text: string; to: string } | null>(null);

  const fill = (x: Invoice) => { setInv(x); setF(toForm(x)); onChanged?.(x); };
  useEffect(() => { loadInvoice(id).then(x => { setInv(x); setF(toForm(x)); }).catch(e => toast(e.message, 'error')); }, [id, toast]);
  if (!inv || !f) return <Drawer title="Invoice" onClose={onClose}><div className="empty-state"><i className="ti ti-loader" />Loading…</div></Drawer>;

  const locked = inv.status === 'paid' || inv.status === 'void';
  const dirty = JSON.stringify(toForm(inv)) !== JSON.stringify(f);
  const subtotal = f.lines.reduce((a, l) => a + Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0) * 100), 0);
  const tax = inv.currency === 'INR' ? Math.round(subtotal * (Number(f.gst) || 0) / 100) : 0;
  const run = async (key: string, fn: () => Promise<Invoice | void>, done?: string) => {
    setBusy(key);
    try { const x = await fn(); if (x) fill(x); if (done) toast(done, 'success'); return true; }
    catch (e: any) { toast(e.message, 'error', 9000); return false; }
    finally { setBusy(null); }
  };
  const save = () => run('save', () => saveInvoice(inv.id, {
    items: f.lines.map(l => ({ text: l.text, qty: Number(l.qty) || 1, rate: Number(l.rate) || 0 })),
    client: { name: f.name, email: f.email, address: f.address, taxId: f.taxId }, note: f.note, gstPercent: Number(f.gst) || 0,
    ...(f.due ? { dueAt: new Date(`${f.due}T12:00:00`).toISOString() } : {}),
  }), 'Saved.');
  const openCompose = async (kind: 'send' | 'remind') => {
    if (dirty && !(await save())) return;
    try { const m = await invoiceMessage(inv.id, kind); setCompose({ kind, text: m.text, to: m.to }); } catch (e: any) { toast(e.message, 'error'); }
  };
  const setLine = (i: number, patch: Partial<Line>) => setF({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });

  const status = inv.status === 'paid' ? `Paid ${timeAgo(inv.paidAt!)}`
    : inv.issuedAt ? `${INVOICE_STATUS[inv.status]} ${timeAgo(inv.issuedAt)}${inv.views ? ` · opened ${inv.views}×` : ''}${inv.overdue ? ' · overdue' : ''}`
    : INVOICE_STATUS[inv.status];

  return (
    <Drawer title={`${inv.number} · ${money(inv.total, inv.currency)}`} subtitle={<>{inv.client.name || inv.client.email || 'No client yet'} · {status}</>} onClose={onClose} width={680}
      footer={(
        <div className="cl-meta" style={{ width: '100%', flexWrap: 'wrap' }}>
          {!locked && <button className="btn btn-danger btn-sm" type="button" disabled={!!busy}
            onClick={() => window.confirm(`Cancel ${inv.number}? It stays listed as cancelled — invoice numbers are never reused.`) && run('void', () => voidInvoice(inv.id), 'Cancelled.')}>Cancel invoice</button>}
          <a className="btn btn-sm" href={invoicePreviewUrl(inv.id)} target="_blank" rel="noopener noreferrer"><i className="ti ti-eye" /> Preview</a>
          {inv.link && <button className="btn btn-sm" type="button" onClick={() => navigator.clipboard.writeText(inv.link).then(() => toast('Link copied.', 'success'))}><i className="ti ti-link" /> Copy link</button>}
          <span style={{ flex: 1 }} />
          {!locked && dirty && <button className="btn" type="button" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>}
          {inv.status === 'paid'
            ? <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => run('paid', () => markInvoicePaid(inv.id, false), 'Marked unpaid.')}>Mark unpaid</button>
            : !locked && <>
              {inv.status !== 'draft' && <button className="btn" type="button" disabled={!!busy} onClick={() => openCompose('remind')}>Send reminder</button>}
              {inv.status === 'draft' && <button className="btn btn-primary" type="button" disabled={!!busy} onClick={() => openCompose('send')}><i className="ti ti-send" /> Send to client</button>}
              {inv.status !== 'draft' && <button className="btn btn-primary" type="button" disabled={!!busy}
                onClick={async () => {
                  setBusy('paid');
                  try { const x = await markInvoicePaid(inv.id, true); fill(x); toast(x.dealPaid ? 'Paid — and the deal is fully paid. 🎉' : 'Marked paid.', 'success', 6000); }
                  catch (e: any) { toast(e.message, 'error'); } finally { setBusy(null); }
                }}><i className="ti ti-check" /> Mark paid</button>}
            </>}
        </div>
      )}>
      {inv.reminder && !compose && (
        <div className="info-box" style={{ marginBottom: 12 }}>
          <i className="ti ti-bell" /><div style={{ flex: 1 }}>{inv.reminder}</div>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => openCompose('remind')}>Write a reminder</button>
        </div>
      )}
      {compose && (
        <div className="cl-sect" style={{ background: 'var(--canvas)', borderRadius: 12, padding: 14, marginBottom: 12, border: '1px solid var(--border)' }}>
          <h3>{compose.kind === 'send' ? `Email to ${compose.to || 'the client'}` : 'Reminder, in the same thread'}</h3>
          <textarea rows={8} value={compose.text} onChange={e => setCompose({ ...compose, text: e.target.value })} />
          <div className="cl-hint">{'{{link}}'} becomes the invoice’s link. It goes from your Gmail.</div>
          <div className="cl-meta" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" type="button" onClick={() => setCompose(null)}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" type="button" disabled={!!busy}
              onClick={() => run(compose.kind, () => (compose.kind === 'send' ? sendInvoice(inv.id, compose.text) : remindInvoice(inv.id, compose.text)),
                compose.kind === 'send' ? 'Sent from your Gmail.' : 'Reminder sent.').then(ok => ok && setCompose(null))}>
              {busy === compose.kind ? 'Sending…' : 'Send from Gmail'}
            </button>
          </div>
        </div>
      )}

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="cl-sect">
          <h3>Lines</h3>
          {f.lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 130px auto', gap: 6, marginBottom: 6 }}>
              <input type="text" aria-label="What for" value={l.text} maxLength={300} onChange={e => setLine(i, { text: e.target.value })} />
              <input type="number" aria-label="Quantity" min={0} step="any" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
              <input type="number" aria-label={`Rate (${inv.currency})`} min={0} step="any" value={l.rate} onChange={e => setLine(i, { rate: e.target.value })} />
              <button className="btn btn-xs" type="button" aria-label="Remove line" disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, n) => n !== i) })}><i className="ti ti-x" /></button>
            </div>
          ))}
          <button className="btn btn-sm" type="button" onClick={() => setF({ ...f, lines: [...f.lines, { text: '', qty: '1', rate: '' }] })}><i className="ti ti-plus" /> Add a line</button>
          <div className="cl-meta" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            {inv.currency === 'INR' && (
              <label className="cl-meta">GST
                <select value={f.gst} style={{ width: 'auto' }} onChange={e => setF({ ...f, gst: e.target.value })}>
                  {['0', '5', '12', '18', '28'].map(g => <option key={g} value={g}>{g === '0' ? 'none' : `${g}%`}</option>)}
                </select>
              </label>
            )}
            <span>Subtotal {money(subtotal, inv.currency)}{tax ? ` · GST ${money(tax, inv.currency)}` : ''} · <b style={{ color: 'var(--text)' }}>Total {money(subtotal + tax, inv.currency)}</b></span>
          </div>
        </div>

        <div className="cl-sect">
          <h3>Client</h3>
          <div className="cl-cols">
            <div className="form-group"><label className="form-label" htmlFor="iv-name">Name</label><input id="iv-name" type="text" value={f.name} maxLength={160} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="iv-email">Email</label><input id="iv-email" type="email" value={f.email} maxLength={200} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          </div>
          <div className="cl-cols">
            <div className="form-group"><label className="form-label" htmlFor="iv-addr">Address (optional)</label><textarea id="iv-addr" rows={2} value={f.address} maxLength={500} onChange={e => setF({ ...f, address: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="iv-gstin">Their GSTIN (optional)</label><input id="iv-gstin" type="text" value={f.taxId} maxLength={40} onChange={e => setF({ ...f, taxId: e.target.value.toUpperCase() })} /></div>
          </div>
        </div>
        <div className="cl-cols">
          <div className="form-group"><label className="form-label" htmlFor="iv-due">Due</label><input id="iv-due" type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="iv-note">Note (optional)</label><input id="iv-note" type="text" value={f.note} maxLength={600} placeholder="Thank you for the work!" onChange={e => setF({ ...f, note: e.target.value })} /></div>
        </div>
      </fieldset>
      {inv.deal && <div className="cl-row-sub">For the deal <Link to={`/deals?d=${inv.deal.id}`}>{inv.deal.name}</Link></div>}
      {inv.remindersSent.length > 0 && <div className="cl-row-sub">Reminders sent: {inv.remindersSent.map(d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })).join(', ')}</div>}
      <div className="cl-hint">How the client pays comes from My profile → Getting paid (UPI ID for rupees, bank or PayPal details otherwise).</div>
    </Drawer>
  );
}
