import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Drawer from './Drawer';
import InfoTip from './InfoTip';
import { useToast } from '../context/ToastContext';
import { createProposal, deleteDeal, invoiceRest, loadDeal, loadInvoices, loadProposals, updateDeal, type Invoice, type Proposal, type CallNotes, type Currency, type Deal, type DealDetail, type DealStage } from '../lib/api';
import { money } from '../lib/money';
import { timeAgo } from '../lib/leads';

export const STAGE_LABEL: Record<DealStage, string> = {
  talking: 'Talking', call: 'Call booked', proposal: 'Proposal sent', won: 'Won',
  progress: 'In progress', delivered: 'Delivered', paid: 'Paid', lost: 'Lost',
};
const NOTES: [keyof CallNotes, string, string][] = [
  ['budget', 'Budget', 'What they said about money'],
  ['timeline', 'Timeline', 'When they need it, and why then'],
  ['decider', 'Who decides', 'Them, a co-founder, a manager…'],
  ['done', 'What “done” looks like', 'In their words — this is what the proposal is built on'],
  ['other', 'Anything else', ''],
];

/**
 * One deal: where it stands, what it's worth, your next step, red flags from what
 * they wrote, call notes (the proposal is drafted from these), the thread, and how
 * it got here. Changes save with one press.
 */
export default function DealDrawer({ id, onClose, onChanged, onDeleted }: {
  id: string; onClose: () => void; onChanged: (d: Deal) => void; onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [d, setD] = useState<DealDetail | null>(null);
  const [form, setForm] = useState<{ name: string; client: string; email: string; value: string; currency: Currency; next: string; stage: DealStage; lostReason: string; notes: CallNotes } | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [writing, setWriting] = useState<'ai' | 'blank' | null>(null);
  useEffect(() => { loadProposals(id).then(r => setProposals(r.proposals)).catch(() => {}); }, [id]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const loadInv = () => loadInvoices(id).then(r => setInvoices(r.invoices)).catch(() => {});
  useEffect(() => { loadInv(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const newProposal = async (ai: boolean) => {
    setWriting(ai ? 'ai' : 'blank');
    try { const p = await createProposal(id, ai); navigate(`/proposals?p=${p.id}`); }
    catch (e: any) { toast(e.message, 'error', 9000); }
    finally { setWriting(null); }
  };

  const fill = (x: DealDetail) => {
    setD(x);
    setForm({ name: x.name, client: x.client, email: x.email, value: x.value ? String(x.value / 100) : '', currency: x.currency, next: x.next, stage: x.stage, lostReason: x.lostReason, notes: { ...x.callNotes } });
  };
  useEffect(() => { setD(null); loadDeal(id).then(fill).catch(e => toast(e.message, 'error')); }, [id, toast]);

  if (!d || !form) return <Drawer title="Deal" onClose={onClose}><div className="empty-state"><i className="ti ti-loader" />Loading…</div></Drawer>;

  const dirty = form.name !== d.name || form.client !== d.client || form.email !== d.email || form.next !== d.next || form.stage !== d.stage
    || form.lostReason !== d.lostReason || form.currency !== d.currency || Number(form.value || 0) * 100 !== d.value
    || NOTES.some(([k]) => form.notes[k] !== d.callNotes[k]);
  const save = async () => {
    if (form.stage === 'lost' && !form.lostReason.trim()) { toast('Say why it was lost — it’s how you learn which leads to skip.', 'error'); return; }
    setBusy(true);
    try {
      const u = await updateDeal(d.id, {
        name: form.name, client: form.client, email: form.email, next: form.next, stage: form.stage, lostReason: form.lostReason,
        currency: form.currency, value: Number(form.value || 0), callNotes: form.notes,
      });
      fill({ ...d, ...u }); onChanged(u); toast('Saved.', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${d.name}”? Its history goes too. To keep it, move it to Lost instead.`)) return;
    try { await deleteDeal(d.id); onDeleted(d.id); onClose(); } catch (e: any) { toast(e.message, 'error'); }
  };
  const set = (patch: Partial<typeof form>) => setForm(f => f && { ...f, ...patch });

  return (
    <Drawer title={d.name} subtitle={<>{d.client || d.email}{d.value ? ` · ${money(d.value, d.currency)}` : ''} · {STAGE_LABEL[d.stage]}</>} onClose={onClose} width={600}
      footer={(
        <div className="cl-meta" style={{ width: '100%' }}>
          <button className="btn btn-danger btn-sm" type="button" onClick={remove}>Delete</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}>
      <div className="cl-sect">
        <div className="cl-cols">
          <div className="form-group">
            <label className="form-label" htmlFor="dl-stage">Stage <InfoTip text="Where this deal is: Talking → Call booked → Proposal sent → Won → In progress → Delivered → Paid (or Lost). Sending a proposal, an acceptance and the last payment move it for you." /></label>
            <select id="dl-stage" value={form.stage} onChange={e => set({ stage: e.target.value as DealStage })}>
              {(Object.keys(STAGE_LABEL) as DealStage[]).map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="dl-value">Value <InfoTip text="What the whole job is worth, before GST. It starts from the budget they mentioned; when they accept a proposal it becomes the price of the option they chose." /></label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select aria-label="Currency" value={form.currency} style={{ width: 82 }} onChange={e => set({ currency: e.target.value as Currency })}>
                {['INR', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input id="dl-value" type="number" min={0} value={form.value} placeholder="0" onChange={e => set({ value: e.target.value })} />
            </div>
          </div>
        </div>
        {form.stage === 'lost' && (
          <div className="form-group">
            <label className="form-label" htmlFor="dl-lost">Why it was lost <InfoTip text="One line on why it didn’t happen. Over time it shows which kinds of leads to skip." /></label>
            <input id="dl-lost" type="text" maxLength={200} value={form.lostReason} placeholder="Went with someone cheaper, project cancelled, no reply…" onChange={e => set({ lostReason: e.target.value })} />
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="dl-next">Your next step <InfoTip text="The one thing you’ll do next, shown on the card so nothing stalls: “Send the price”, “Call Thursday 4 pm”." /></label>
          <input id="dl-next" type="text" maxLength={200} value={form.next} placeholder="Send the price · Call Thursday 4 pm · Ask what “urgent” means" onChange={e => set({ next: e.target.value })} />
        </div>
      </div>

      <div className="cl-sect">
        <h3>Proposals <InfoTip text="A page with three options your client opens from a link and accepts by typing their name. Write a proposal drafts it from the thread, your call notes and your profile." /></h3>
        {proposals.map(p => (
          <Link key={p.id} to={`/proposals?p=${p.id}`} className="cl-row-sub" style={{ display: 'block', padding: '4px 0' }}>
            <b style={{ color: 'var(--text)' }}>{p.title}</b> · {p.status === 'accepted' && p.acceptedBy ? `accepted by ${p.acceptedBy.name}` : p.sentAt ? `sent${p.views ? `, opened ${p.views}×` : ', not opened yet'}` : 'draft'}
          </Link>
        ))}
        <div className="cl-meta" style={{ marginTop: 6 }}>
          <button className="btn btn-sm btn-primary" type="button" disabled={!!writing} onClick={() => newProposal(true)}
            title="Three options drafted from the thread, your call notes and your profile — you check and edit before sending">
            {writing === 'ai' ? <><i className="ti ti-loader" /> Drafting…</> : <><i className="ti ti-sparkles" /> Write a proposal</>}
          </button>
          <button className="btn btn-sm" type="button" disabled={!!writing} onClick={() => newProposal(false)}>Start blank</button>
        </div>
        {!d.callNotes.done && !d.thread && <div className="cl-hint">Tip: fill “What done looks like” in the call notes first — the draft is built on it.</div>}
      </div>

      {(invoices.length > 0 || proposals.some(p => p.status === 'accepted')) && (
        <div className="cl-sect">
          <h3>Invoices <InfoTip text="The deposit invoice is drafted when they accept. Invoice the rest drafts the remaining payments from your split. When all are marked paid, the deal moves to Paid." /></h3>
          {invoices.map(i => (
            <Link key={i.id} to={`/invoices?i=${i.id}`} className="cl-row-sub" style={{ display: 'block', padding: '4px 0' }}>
              <b style={{ color: 'var(--text)' }}>{i.number}</b> · {money(i.total, i.currency)} · {i.status === 'paid' ? 'paid' : i.status === 'void' ? 'cancelled' : i.status === 'draft' ? 'draft — check and send' : i.overdue ? 'overdue' : 'sent'}
            </Link>
          ))}
          {proposals.some(p => p.status === 'accepted') && (
            <button className="btn btn-sm" type="button" style={{ marginTop: 6 }}
              onClick={async () => { try { const r = await invoiceRest(d.id); toast(r.made.length ? `Drafted ${r.made.length} invoice${r.made.length === 1 ? '' : 's'} for the rest.` : 'Everything is already invoiced.', 'success'); loadInv(); } catch (e: any) { toast(e.message, 'error'); } }}>
              <i className="ti ti-receipt" /> Invoice the rest
            </button>
          )}
        </div>
      )}

      {d.flags.length > 0 && (
        <div className="cl-sect">
          <h3>Red flags <InfoTip text="Warning signs spotted by simple rules in what they wrote — unpaid test work, pay after launch, a budget under your minimum. The words that triggered it are shown; you decide if it matters." /></h3>
          {d.flags.map(f => (
            <div key={f.rule} className="cl-note" style={{ marginBottom: 6 }}><b>{f.label}</b>{f.words ? <> — they wrote {f.words}</> : null}</div>
          ))}
          <div className="cl-hint">Spotted by simple rules from what they wrote and your minimum. Your call whether it matters.</div>
        </div>
      )}

      <div className="cl-sect">
        <h3>Call notes <InfoTip text="What you learned from them — budget, timeline, who decides and what done looks like. The proposal is drafted from these, so the more concrete, the better the draft." /></h3>
        {NOTES.map(([k, label, hint]) => (
          <div className="form-group" key={k}>
            <label className="form-label" htmlFor={`dl-n-${k}`}>{label}</label>
            <textarea id={`dl-n-${k}`} rows={k === 'done' || k === 'other' ? 3 : 2} value={form.notes[k]} placeholder={hint}
              onChange={e => set({ notes: { ...form.notes, [k]: e.target.value } })} />
          </div>
        ))}
      </div>

      <div className="cl-sect">
        <h3>Who</h3>
        <div className="cl-cols">
          <div className="form-group"><label className="form-label" htmlFor="dl-name">Deal <InfoTip text="A short name for the work, e.g. “Checkout rebuild”." /></label><input id="dl-name" type="text" maxLength={120} value={form.name} onChange={e => set({ name: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="dl-client">Client <InfoTip text="The company or person paying." /></label><input id="dl-client" type="text" maxLength={120} value={form.client} onChange={e => set({ client: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label" htmlFor="dl-email">Email <InfoTip text="Where proposals and invoices go. Usually filled from their reply." /></label><input id="dl-email" type="email" maxLength={200} value={form.email} onChange={e => set({ email: e.target.value })} /></div>
        {d.lead && <div className="cl-row-sub">Lead: {d.lead.name} · {d.lead.where}{d.lead.postUrl ? <> · <a href={d.lead.postUrl} target="_blank" rel="noopener noreferrer">their post</a></> : null}</div>}
      </div>

      {d.thread && (
        <div className="cl-sect">
          <h3>Latest in the thread</h3>
          {d.thread.messages.slice(-3).map((m, i) => (
            <div key={i} className={`cl-msg ${m.direction}`}>
              <div className="meta">{m.direction === 'in' ? (d.person || d.client) : 'You'} · {timeAgo(m.at)}</div>
              {(m.text || '').slice(0, 600)}{(m.text || '').length > 600 ? '…' : ''}
            </div>
          ))}
          <Link to={`/inbox?c=${d.thread.id}`} className="btn btn-sm"><i className="ti ti-message" /> Open in Inbox</Link>
        </div>
      )}

      <div className="cl-sect">
        <h3>History</h3>
        {[...d.stageHistory].reverse().map((h, i) => (
          <div key={i} className="cl-row-sub">{STAGE_LABEL[h.stage]} · {new Date(h.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        ))}
      </div>
    </Drawer>
  );
}
