import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small ⓘ beside a label: what the field means, on hover, tap or keyboard focus.
 * Rendered into <body> so a drawer's scroll can't clip it (same as NavTip).
 */
export default function InfoTip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const WIDTH = 260;
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 8, left: Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8) });
  };
  const hide = () => setPos(null);
  return (
    <>
      <span ref={ref} className="cl-info" tabIndex={0} role="button" aria-label={text}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={e => { e.preventDefault(); e.stopPropagation(); if (pos) hide(); else show(); }}>
        <i className="ti ti-info-circle" />
      </span>
      {pos && createPortal(<div className="nav-tip-body" role="tooltip" style={{ top: pos.top, left: pos.left, width: WIDTH, transform: 'none' }}>{text}</div>, document.body)}
    </>
  );
}
