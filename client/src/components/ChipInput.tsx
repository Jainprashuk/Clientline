import { useState, type KeyboardEvent } from 'react';

/** Phrases as removable chips. Enter or comma adds; Backspace on an empty field removes the last. */
export default function ChipInput({ value, onChange, placeholder, max = 30, label, suggestions = [] }: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  label: string;
  /** Offered below as one-click additions, minus any already added. */
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (draft.trim()) add(draft); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  const offered = suggestions.filter(s => !value.includes(s)).slice(0, 8);
  return (
    <>
      <div className="cl-chips">
        {value.map(v => (
          <span className="cl-chip" key={v}>
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter(x => x !== v))}><i className="ti ti-x" /></button>
          </span>
        ))}
        <input type="text" aria-label={label} value={draft} placeholder={value.length >= max ? 'Limit reached' : placeholder}
          disabled={value.length >= max}
          onChange={e => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft.trim() && add(draft)} />
      </div>
      {offered.length > 0 && (
        <div className="cl-suggest">
          Add:
          {offered.map(s => <button type="button" key={s} onClick={() => add(s)}>+ {s}</button>)}
        </div>
      )}
    </>
  );
}
