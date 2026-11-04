import { useState } from 'react';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import { previewPaste, importPaste, type PastePreview, type SourceRun } from '../lib/api';

/**
 * Paste a WhatsApp/Telegram export or any post. Preview shows what would become a
 * lead and why each message would not — nothing is saved until Import.
 */
export default function PasteDrawer({ onClose, onImported }: { onClose: () => void; onImported: (run: SourceRun) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PastePreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);

  const doPreview = async () => {
    setBusy('preview');
    try { setPreview(await previewPaste(text)); }
    catch (e: any) { toast(e.message, 'error', 6000); }
    finally { setBusy(null); }
  };
  const doImport = async () => {
    setBusy('import');
    try {
      const { run } = await importPaste(text);
      toast(run.created ? `${run.created} lead${run.created === 1 ? '' : 's'} added.` : 'Nothing new to add.', run.created ? 'success' : 'info');
      onImported(run);
    } catch (e: any) { toast(e.message, 'error', 6000); }
    finally { setBusy(null); }
  };

  const reasons = preview ? Object.entries(preview.reasons).sort((a, b) => b[1] - a[1]) : [];
  const footer = (
    <>
      <button className="btn" type="button" disabled={!text.trim() || busy !== null} onClick={doPreview}>
        {busy === 'preview' ? <><i className="ti ti-loader" /> Checking…</> : 'Preview'}
      </button>
      <span className="spacer" />
      <button className="btn btn-primary" type="button" disabled={!preview || !(preview.kept + preview.held) || busy !== null} onClick={doImport}>
        {busy === 'import' ? <><i className="ti ti-loader" /> Adding…</> : preview ? `Add ${preview.kept + preview.held} lead${preview.kept + preview.held === 1 ? '' : 's'}` : 'Add leads'}
      </button>
    </>
  );

  return (
    <Drawer title="Paste a chat or post" subtitle="A WhatsApp or Telegram group export, a newsletter, or a single post. Each message is checked against your profile." onClose={onClose} footer={footer} width={640}>
      <div className="form-group">
        <label className="form-label" htmlFor="paste-text">Text</label>
        <textarea id="paste-text" rows={preview ? 6 : 14} value={text} placeholder="[02/11/26, 9:41 PM] Ritika: Our startup is looking for a freelance React developer…"
          onChange={e => { setText(e.target.value); setPreview(null); }} />
        <div className="cl-hint">In WhatsApp: open the group → ⋮ → More → Export chat → Without media, then paste the text here.</div>
      </div>

      {preview && (
        <>
          <div className="cl-meta" style={{ margin: '6px 0 10px' }}>
            <strong style={{ color: 'var(--text)' }}>{preview.messages} messages</strong>
            <span>· {preview.considered} looked like a request</span>
            <span>· <b style={{ color: 'var(--green)' }}>{preview.kept} leads</b></span>
            {preview.held > 0 && <span>· {preview.held} without an email</span>}
            <span>· {preview.dropped} skipped</span>
          </div>
          {reasons.length > 0 && (
            <div className="cl-hint" style={{ marginBottom: 10 }}>
              Skipped: {reasons.map(([r, n]) => `${n} ${r.toLowerCase()}`).join(' · ')}
            </div>
          )}
          <div className="table-card">
            <table>
              <thead><tr><th>Result</th><th>Who</th><th>Message</th></tr></thead>
              <tbody>
                {preview.preview.map((r, i) => (
                  <tr key={i} className="cl-preview-row">
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div className={`cl-verdict ${r.verdict}`}>{r.verdict === 'new' ? `Lead · ${r.fit}` : r.verdict === 'held' ? 'No email' : 'Skipped'}</div>
                      {r.verdict === 'drop' && <div className="cl-row-sub" style={{ maxWidth: 170, whiteSpace: 'normal' }}>{r.reason}</div>}
                    </td>
                    <td>{r.name || '—'}{r.email && <div className="cl-row-sub">{r.email}</div>}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 220 }}><div className="cl-clamp">{r.text}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Drawer>
  );
}
