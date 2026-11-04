import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A right-hand panel over the page (Outreach's .user-drawer). Escape or a click on
 * the backdrop closes it; focus moves in on open and back to the opener on close.
 *
 * Rendered into <body>: the page's .section animates with a transform, which would
 * otherwise make it the box a position:fixed panel is placed in.
 */
export default function Drawer({ title, subtitle, onClose, children, footer, width = 560 }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [onClose]);
  return createPortal(
    <div className="user-drawer-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="user-drawer cl-drawer" role="dialog" aria-modal="true" tabIndex={-1} ref={panel}
        style={{ width: `min(${width}px, 100vw)` }}>
        <div className="cl-drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn-xs" aria-label="Close" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="cl-drawer-body">{children}</div>
        {footer ? <div className="cl-drawer-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
