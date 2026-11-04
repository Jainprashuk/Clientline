import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { loadSequences, enrollLeads, type Sequence } from '../lib/api';

/** Pick a sequence and add one or more leads to it. Reasons for any that can't go in are shown. */
export default function AddToSequence({ leadIds, onAdded, compact = false }: { leadIds: string[]; onAdded: (added: string[]) => void; compact?: boolean }) {
  const toast = useToast();
  const [seqs, setSeqs] = useState<Sequence[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadSequences().then(r => { setSeqs(r.sequences); setPick(p => p || (r.sequences.find(s => s.active) || r.sequences[0] || { id: '' }).id); }).catch(() => setSeqs([]));
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      const r = await enrollLeads(leadIds, pick);
      if (r.added.length) {
        toast(`${r.added.length === 1 ? 'Added' : `${r.added.length} added`} to “${r.sequence.name}”.${r.sequence.active ? ' The first email goes out next time you send.' : ' The sequence is paused — resume it on the Outreach page.'}`, 'success', 6000);
      }
      if (r.skipped.length) {
        const first = r.skipped[0];
        toast(r.skipped.length === 1 ? `Not added — ${first.reason}.` : `${r.skipped.length} not added (e.g. ${first.name}: ${first.reason}).`, 'info', 8000);
      }
      onAdded(r.added);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  if (seqs && !seqs.length) return <Link className="btn btn-sm" to="/outreach">Create a sequence</Link>;
  return (
    <span className="cl-meta" style={{ gap: 6 }}>
      <select aria-label="Sequence" value={pick} onChange={e => setPick(e.target.value)} style={{ width: 'auto', maxWidth: compact ? 170 : 220 }} disabled={!seqs}>
        {(seqs || []).map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (paused)'}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" type="button" disabled={busy || !pick || !leadIds.length} onClick={add}>
        {busy ? <><i className="ti ti-loader" /> Adding…</> : <><i className="ti ti-send" /> Add to sequence</>}
      </button>
    </span>
  );
}
