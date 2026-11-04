import { useState } from 'react';
import type { Service } from '../lib/api';
import { SERVICE_PRESETS, suggestKeywords } from '../lib/presets';

/**
 * What the user sells: tap the tiles that fit, or add your own when it isn't there.
 * A tile brings its keywords with it, so nobody has to know what a "keyword" is.
 */
export default function ServicePicker({ value, onChange, max = 10 }: {
  value: Service[];
  onChange: (next: Service[]) => void;
  max?: number;
}) {
  const [custom, setCustom] = useState('');
  const has = (name: string) => value.some(s => s.name.toLowerCase() === name.toLowerCase());
  const toggle = (name: string, keywords: string[]) => {
    if (has(name)) onChange(value.filter(s => s.name.toLowerCase() !== name.toLowerCase()));
    else if (value.length < max) onChange([...value, { name, keywords, minBudget: 0 }]);
  };
  const addCustom = () => {
    const name = custom.replace(/\s+/g, ' ').trim();
    if (!name || has(name) || value.length >= max) { setCustom(''); return; }
    const preset = SERVICE_PRESETS.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
    if (preset && !has(preset.name)) onChange([...value, { name: preset.name, keywords: preset.keywords, minBudget: 0 }]);
    else onChange([...value, { name, keywords: suggestKeywords(name), minBudget: 0 }]);
    setCustom('');
  };
  const customs = value.filter(s => !SERVICE_PRESETS.some(p => p.name === s.name));
  return (
    <>
      <div className="cl-tiles" role="group" aria-label="Services">
        {SERVICE_PRESETS.map(p => (
          <button key={p.id} type="button" className="cl-tile" aria-pressed={has(p.name)} onClick={() => toggle(p.name, p.keywords)}>
            <i className={`ti ${p.icon}`} />{p.name}<i className="ti ti-check tick" />
          </button>
        ))}
        {customs.map(s => (
          <button key={s.name} type="button" className="cl-tile" aria-pressed onClick={() => toggle(s.name, s.keywords)} title="Click to remove">
            <i className="ti ti-sparkles" />{s.name}<i className="ti ti-check tick" />
          </button>
        ))}
      </div>
      <div className="cl-tile-add">
        <input type="text" aria-label="Add your own service" value={custom} maxLength={60} placeholder="Not in the list? Type what you do, e.g. “Webflow sites”"
          list="cl-service-names" onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <datalist id="cl-service-names">{SERVICE_PRESETS.filter(p => !has(p.name)).map(p => <option key={p.id} value={p.name} />)}</datalist>
        <button type="button" className="btn" disabled={!custom.trim() || value.length >= max} onClick={addCustom}><i className="ti ti-plus" /> Add</button>
      </div>
    </>
  );
}
