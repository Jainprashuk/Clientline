import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Pick from a list, or add your own. Picked values show as removable chips.
 *
 * Focusing the field opens the list of options not yet picked; typing filters it,
 * and when what you typed isn't in the list the first row offers to add it.
 * Enter or comma adds; Backspace on an empty field removes the last chip.
 */
export default function ChipInput({ value, onChange, placeholder, max = 30, label, suggestions = [], format = (s: string) => s }: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  label: string;
  /** The list to pick from. */
  suggestions?: string[];
  /** How an option is shown (values stay as stored). */
  format?: (s: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  const clean = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const typed = clean(draft);
  const options = useMemo(() => {
    const left = suggestions.filter(s => !value.includes(s));
    const hits = typed ? left.filter(s => s.includes(typed) || format(s).toLowerCase().includes(typed)) : left;
    const rows: { value: string; isNew: boolean }[] = hits.slice(0, 8).map(v => ({ value: v, isNew: false }));
    if (typed && !value.includes(typed) && !suggestions.includes(typed)) rows.unshift({ value: typed, isNew: true });
    return rows;
  }, [suggestions, value, typed, format]);

  const add = (raw: string) => {
    const parts = raw.split(',').map(clean).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    if (next.length !== value.length) onChange(next);
    setDraft(''); setActive(0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (open && options[active]) add(options[active].value);
      else if (draft.trim()) add(draft);
    } else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  const full = value.length >= max;

  return (
    <div className="cl-combo" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setOpen(false); if (draft.trim()) add(draft); } }}>
      <div className="cl-chips" onClick={() => input.current?.focus()}>
        {value.map(v => (
          <span className="cl-chip" key={v}>
            {format(v)}
            <button type="button" aria-label={`Remove ${format(v)}`} onClick={() => onChange(value.filter(x => x !== v))}><i className="ti ti-x" /></button>
          </span>
        ))}
        <input ref={input} type="text" role="combobox" aria-label={label} aria-expanded={open && options.length > 0} aria-controls={listId}
          value={draft} placeholder={full ? 'Limit reached' : value.length ? 'Add more…' : placeholder} disabled={full}
          onFocus={() => setOpen(true)} onChange={e => { setDraft(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey} />
        {suggestions.length > 0 && !full && (
          <button type="button" className="cl-combo-caret" tabIndex={-1} aria-label="Show options" onMouseDown={e => { e.preventDefault(); setOpen(o => !o); input.current?.focus(); }}>
            <i className="ti ti-chevron-down" />
          </button>
        )}
      </div>
      {open && options.length > 0 && !full && (
        <ul className="cl-combo-list" role="listbox" id={listId}>
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={e => { e.preventDefault(); add(o.value); }} onMouseEnter={() => setActive(i)}>
              {o.isNew ? <><i className="ti ti-plus" /> Add “{draft.trim()}”</> : format(o.value)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
