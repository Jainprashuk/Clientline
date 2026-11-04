import { useEffect, useRef, useState } from 'react';
import Drawer from './Drawer';
import { useToast } from '../context/ToastContext';
import { updateSequence, deleteSequence, previewSequence, type Sequence, type SeqStep, type StepPreview, type Variable } from '../lib/api';

const MAX_STEPS = 5;

/**
 * Edit a sequence: its name, how many new people start a day, and its steps. A
 * variable chip inserts {{variable}} at the cursor; Preview renders every step for
 * a real lead, and says which variable would stop an email going out.
 */
export default function SequenceEditor({ seq, variables, onClose, onSaved, onDeleted }: {
  seq: Sequence; variables: Variable[];
  onClose: () => void; onSaved: (s: Sequence) => void; onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(seq.name);
  const [perDay, setPerDay] = useState(String(seq.newPerDay));
  const [steps, setSteps] = useState<SeqStep[]>(seq.steps.map(s => ({ ...s })));
  const [focus, setFocus] = useState<{ i: number; field: 'subject' | 'body' } | null>(null);
  const [preview, setPreview] = useState<{ lead: string; steps: StepPreview[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const dirty = name !== seq.name || Number(perDay) !== seq.newPerDay || JSON.stringify(steps) !== JSON.stringify(seq.steps);
  const set = (i: number, patch: Partial<SeqStep>) => { setSteps(st => st.map((s, n) => (n === i ? { ...s, ...patch } : s))); setPreview(null); };

  const insert = (key: string) => {
    const f = focus || { i: steps.length - 1, field: 'body' as const };
    const el = refs.current[`${f.i}-${f.field}`];
    const token = `{{${key}}}`;
    const cur = steps[f.i][f.field];
    const at = el && typeof el.selectionStart === 'number' ? el.selectionStart : cur.length;
    set(f.i, { [f.field]: cur.slice(0, at) + token + cur.slice(at) } as Partial<SeqStep>);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } });
  };

  const addStep = () => {
    const last = steps[steps.length - 1];
    setSteps(st => [...st, { kind: 'email', dayOffset: (last ? last.dayOffset : 0) + 4, subject: '', body: 'Hi {{first}},\n\n\n\n{{myName}}' }]);
    setPreview(null);
  };

  useEffect(() => { setPreview(null); }, [steps.length]);

  const doPreview = async () => {
    setBusy('preview');
    try {
      const r = await previewSequence(steps);
      setPreview({ lead: r.lead ? `${r.lead.person ? `${r.lead.person}, ` : ''}${r.lead.name}` : 'a sample lead (you have none with an email yet)', steps: r.steps });
    } catch (e: any) { toast(e.message, 'error', 6000); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save');
    try { const s = await updateSequence(seq.id, { name, newPerDay: Number(perDay), steps }); onSaved(s); toast('Sequence saved.', 'success'); }
    catch (e: any) { toast(e.message, 'error', 7000); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${seq.name}”?`)) return;
    setBusy('delete');
    try { await deleteSequence(seq.id); onDeleted(seq.id); toast('Sequence deleted.', 'success'); }
    catch (e: any) { toast(e.message, 'error', 7000); }
    finally { setBusy(null); }
  };

  const footer = (
    <>
      <button className="btn btn-primary" type="button" disabled={!dirty || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      <button className="btn" type="button" disabled={busy !== null} onClick={doPreview}>{busy === 'preview' ? 'Rendering…' : 'Preview with a real lead'}</button>
      <span className="spacer" />
      <button className="btn btn-danger" type="button" disabled={busy !== null} onClick={remove}>Delete</button>
    </>
  );

  return (
    <Drawer width={680} title="Edit sequence" subtitle="Emails go from your Gmail. Later emails reply in the same thread, and every email has an unsubscribe line." onClose={onClose} footer={footer}>
      <div className="cl-cols">
        <div className="form-group"><label className="form-label" htmlFor="sq-name">Name</label>
          <input id="sq-name" type="text" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label" htmlFor="sq-day">New people a day, at most</label>
          <input id="sq-day" type="number" min={1} max={100} value={perDay} onChange={e => setPerDay(e.target.value)} /></div>
      </div>

      <div className="cl-meta" style={{ margin: '4px 0 12px' }}>
        <span>Insert:</span>
        {variables.map(v => <button key={v.key} type="button" className="cl-toggle" title={v.label} onMouseDown={e => e.preventDefault()} onClick={() => insert(v.key)}>{`{{${v.key}}}`}</button>)}
      </div>

      {steps.map((s, i) => (
        <div className="cl-row" key={i}>
          {i > 0 && <button type="button" className="btn btn-xs cl-row-remove" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(st => st.filter((_, n) => n !== i))}><i className="ti ti-x" /></button>}
          <div className="cl-meta">
            <strong style={{ color: 'var(--text)' }}>Step {i + 1}</strong>
            {i === 0 ? <span>· sent the day they’re added</span> : (
              <>
                <span>· day</span>
                <input type="number" min={1} max={60} aria-label={`Day for step ${i + 1}`} value={s.dayOffset} style={{ width: 72 }}
                  onChange={e => set(i, { dayOffset: Math.max(1, Number(e.target.value) || 1) })} />
                <select aria-label={`Kind of step ${i + 1}`} value={s.kind} style={{ width: 'auto' }} onChange={e => set(i, { kind: e.target.value as SeqStep['kind'] })}>
                  <option value="email">Email (same thread)</option>
                  <option value="task">Task for you</option>
                </select>
              </>
            )}
          </div>
          {i === 0 && (
            <input type="text" aria-label="Subject" maxLength={160} placeholder="Subject" value={s.subject}
              ref={el => { refs.current[`${i}-subject`] = el; }} onFocus={() => setFocus({ i, field: 'subject' })}
              onChange={e => set(i, { subject: e.target.value })} />
          )}
          <textarea aria-label={`Step ${i + 1} ${s.kind === 'task' ? 'task' : 'email'}`} rows={s.kind === 'task' ? 2 : 7} maxLength={4000}
            placeholder={s.kind === 'task' ? 'e.g. Connect with them on LinkedIn' : ''} value={s.body}
            ref={el => { refs.current[`${i}-body`] = el; }} onFocus={() => setFocus({ i, field: 'body' })}
            onChange={e => set(i, { body: e.target.value })} />
          {preview && preview.steps[i] && (
            preview.steps[i].ok
              ? <div className="cl-signal"><div className="src" style={{ marginBottom: 4 }}>For {preview.lead}{preview.steps[i].subject ? ` · subject: ${preview.steps[i].subject}` : ''}</div><div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{preview.steps[i].body}</div></div>
              : <div className="cl-note">Won’t send for {preview.lead}: {preview.steps[i].why}.</div>
          )}
        </div>
      ))}
      {steps.length < MAX_STEPS && <button type="button" className="btn" onClick={addStep}><i className="ti ti-plus" /> Add a step</button>}
    </Drawer>
  );
}
