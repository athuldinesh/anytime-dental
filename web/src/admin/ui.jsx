import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle, WarningCircle } from '@phosphor-icons/react';

/* ---------------- toasts */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, text, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} className={`toast ${t.kind}`} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}>
              {t.kind === 'error' ? <WarningCircle size={18} /> : <CheckCircle size={18} />} {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- side drawer (enters and leaves from the right) */
export function Drawer({ open, onClose, title, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    setTimeout(() => ref.current?.querySelector('input, select, textarea, button:not(.drawer-x)')?.focus(), 60);
    return () => { window.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`drawer ${wide ? 'wide' : ''}`}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', bounce: 0, duration: 0.42 }}>
            <header className="drawer-h">
              <h2>{title}</h2>
              <button className="drawer-x icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="drawer-body">{children}</div>
            {footer && <footer className="drawer-f">{footer}</footer>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------------- small pieces */
const STATUS_LABEL = {
  booked: 'Booked', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
  queued: 'Queued', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', received: 'Received', skipped: 'Skipped',
  draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', done: 'Done',
};
export const Badge = ({ s, children }) => <span className={`badge b-${s}`}>{children || STATUS_LABEL[s] || s}</span>;

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={28} weight="light" />}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, t]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{t}</button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, full }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="err">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className="num">{value ?? '–'}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export const Loading = () => <div className="loading"><span className="spin" /> Loading…</div>;
export const ErrorNote = ({ error, retry }) => (
  <div className="error-note"><WarningCircle size={18} /> {error?.message || 'Could not load.'} {retry && <button onClick={retry}>Try again</button>}</div>
);
