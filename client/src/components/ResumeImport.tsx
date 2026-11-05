import { useMemo, useState } from 'react';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import { readResume, type Profile, type ResumeSuggestion } from '../lib/api';
import { pdfText } from '../lib/resumeText';
import { SERVICE_PRESETS, suggestKeywords } from '../lib/presets';

type Project = ResumeSuggestion['projects'][number] & { keep: boolean };

/**
 * "Fill from resume": read a PDF (in the browser) or pasted text, let the AI suggest
 * profile fields, then tick what to keep. Applying only fills the form — you still
 * press Save. Filled fields are kept unless you tick to replace them.
 */
export default function ResumeImport({ profile, onApply, onClose }: {
  profile: Profile;
  onApply: (patch: Partial<Profile>) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'read' | null>(null);
  const [s, setS] = useState<ResumeSuggestion | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [services, setServices] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const serviceNames = useMemo(() => [...new Set([...SERVICE_PRESETS.map(p => p.name), ...profile.services.map(x => x.name)])], [profile.services]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Pick a PDF — or paste the text below.', 'error'); return; }
    setBusy('pdf');
    try { setText(await pdfText(file)); setFileName(file.name); }
    catch (e: any) { toast(e.message, 'error', 8000); }
    finally { setBusy(null); }
  };

  const read = async () => {
    setBusy('read');
    try {
      const { suggestion } = await readResume(text, serviceNames);
      setS(suggestion);
      // Empty fields fill by default; ones you've already filled stay unless you tick them.
      setKeep({
        name: !!suggestion.name && !profile.name.trim(),
        headline: !!suggestion.headline && !profile.headline.trim(),
        portfolioUrl: !!suggestion.portfolioUrl && !profile.portfolioUrl.trim(),
        location: !!suggestion.location && !profile.locations.includes(suggestion.location),
      });
      setServices(suggestion.services.filter(n => !profile.services.some(x => x.name === n)));
      setProjects(suggestion.projects.filter(p => !profile.cases.some(c => c.title.toLowerCase() === p.title.toLowerCase())).map(p => ({ ...p, keep: true })));
    } catch (e: any) { toast(e.message, 'error', 8000); }
    finally { setBusy(null); }
  };

  const apply = () => {
    if (!s) return;
    const patch: Partial<Profile> = {};
    if (keep.name) patch.name = s.name;
    if (keep.headline) patch.headline = s.headline;
    if (keep.portfolioUrl) patch.portfolioUrl = s.portfolioUrl;
    if (keep.location) patch.locations = [...profile.locations, s.location].slice(0, 10);
    if (services.length) {
      patch.services = [...profile.services, ...services.map(name => ({
        name, keywords: SERVICE_PRESETS.find(p => p.name === name)?.keywords || suggestKeywords(name).slice(0, 6), minBudget: 0,
      }))].slice(0, 10);
    }
    const kept = projects.filter(p => p.keep && p.result.trim());
    if (kept.length) patch.cases = [...profile.cases, ...kept.map(({ keep: _k, ...p }) => ({ ...p, client: '' }))].slice(0, 10);
    onApply(patch);
    const dropped = projects.filter(p => p.keep && !p.result.trim()).length;
    toast(`Filled in. Check it, then press Save.${dropped ? ` ${dropped} project${dropped === 1 ? '' : 's'} without a result left out — add one in Your work.` : ''}`, 'success', 8000);
    onClose();
  };

  const row = (key: string, label: string, value: string, current: string) => value ? (
    <label className="cl-meta" style={{ alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!keep[key]} onChange={e => setKeep(k => ({ ...k, [key]: e.target.checked }))} style={{ marginTop: 3 }} />
      <span style={{ flex: 1 }}>
        <span className="cl-row-sub" style={{ display: 'block' }}>{label}{current ? ` — replaces “${current}”` : ''}</span>
        <span style={{ color: 'var(--text)' }}>{value}</span>
      </span>
    </label>
  ) : null;

  return (
    <Drawer title="Fill from your resume" subtitle="Read in your browser — the file isn’t uploaded or kept. Your AI key reads the text." onClose={onClose}
      footer={s ? (
        <div className="cl-meta" style={{ width: '100%' }}>
          <button className="btn" type="button" onClick={() => setS(null)}><i className="ti ti-arrow-left" /> Back</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" type="button" onClick={apply}>Fill in my profile</button>
        </div>
      ) : (
        <div className="cl-meta" style={{ width: '100%' }}>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" type="button" disabled={!!busy || text.trim().length < 200} onClick={read}>
            {busy === 'read' ? <><i className="ti ti-loader" /> Reading…</> : <><i className="ti ti-sparkles" /> Read it</>}
          </button>
        </div>
      )}>
      {!s ? (
        <>
          <label className="cl-drop" style={{ display: 'block', border: '1px dashed var(--border)', borderRadius: 10, padding: 18, textAlign: 'center', cursor: 'pointer', marginBottom: 12 }}
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
            <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => pick(e.target.files?.[0])} />
            <i className="ti ti-file-cv" style={{ fontSize: 22 }} />
            <div style={{ fontWeight: 600, marginTop: 4 }}>{busy === 'pdf' ? 'Reading the PDF…' : fileName || 'Drop your resume PDF here, or click to pick'}</div>
            <div className="cl-row-sub">LinkedIn → More → Save to PDF works too. Word file? Save it as PDF first.</div>
          </label>
          <div className="form-label">Or paste the text</div>
          <textarea rows={12} value={text} onChange={e => setText(e.target.value)} placeholder="Paste your resume or LinkedIn About + Experience here" />
          <div className="cl-hint">Only what the resume says is used: any number, name or link that isn’t in it is refused, and a project without a stated result comes back blank.</div>
        </>
      ) : (
        <>
          <div className="cl-hint" style={{ marginTop: 0 }}>Tick what to use. Fields you’ve already filled stay unless you tick them.</div>
          {row('name', 'Your name', s.name, profile.name.trim() !== s.name ? profile.name.trim() : '')}
          {row('headline', 'One line about you', s.headline, profile.headline.trim() !== s.headline ? profile.headline.trim() : '')}
          {row('portfolioUrl', 'Portfolio or website', s.portfolioUrl, profile.portfolioUrl.trim() !== s.portfolioUrl ? profile.portfolioUrl.trim() : '')}
          {row('location', 'Add to where your clients can be', s.location, '')}

          {s.services.length > 0 && (
            <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div className="cl-row-sub" style={{ marginBottom: 6 }}>Services your work shows</div>
              <div className="cl-toggles" style={{ flexWrap: 'wrap' }}>
                {s.services.map(n => {
                  const have = profile.services.some(x => x.name === n);
                  return (
                    <button key={n} type="button" className="cl-toggle" disabled={have} aria-pressed={have || services.includes(n)}
                      onClick={() => setServices(v => (v.includes(n) ? v.filter(x => x !== n) : [...v, n]))}>
                      {n}{have ? ' · already in' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {projects.length > 0 && (
            <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div className="cl-row-sub" style={{ marginBottom: 6 }}>Projects for your first emails — each needs a result</div>
              {projects.map((p, i) => {
                const upd = (patch: Partial<Project>) => setProjects(list => list.map((x, n) => (n === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="cl-row" style={{ opacity: p.keep ? 1 : 0.55 }}>
                    <label className="cl-meta" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={p.keep} onChange={e => upd({ keep: e.target.checked })} />
                      <b style={{ color: 'var(--text)' }}>{p.title}</b>
                      {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="cl-row-sub">link</a>}
                    </label>
                    <input type="text" aria-label={`Result for ${p.title}`} value={p.result} maxLength={300} disabled={!p.keep}
                      placeholder="No result in the resume — add a real one (e.g. “bookings doubled in 6 weeks”), or it’s left out"
                      onChange={e => upd({ result: e.target.value })} />
                    <select aria-label={`Service ${p.title} proves`} value={p.service} disabled={!p.keep} style={{ marginTop: 6 }} onChange={e => upd({ service: e.target.value })}>
                      <option value="">Which service does it prove?</option>
                      {[...new Set([...profile.services.map(x => x.name), ...services])].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
          {!s.name && !s.headline && !s.services.length && !projects.length && <div className="cl-note">Nothing new found in that text.</div>}
        </>
      )}
    </Drawer>
  );
}
