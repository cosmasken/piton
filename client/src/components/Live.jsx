import React, { useEffect, useRef, useState } from 'react';

/**
 * Flashes its content green (value went up) or red (down) for a moment whenever `value` changes.
 * Pass a number; non-numbers and the first value never flash.
 */
export function Flash({ value, children, className = '', as: Tag = 'span' }) {
  const prev = useRef(value);
  const [fx, setFx] = useState({ dir: null, n: 0 });
  useEffect(() => {
    const a = Number(prev.current), b = Number(value);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) setFx(f => ({ dir: b > a ? 'up' : 'down', n: f.n + 1 }));
    prev.current = value;
  }, [value]);
  // the key restarts the CSS animation on every change
  return <Tag key={fx.n} className={`${className} ${fx.dir === 'up' ? 'flash-up' : fx.dir === 'down' ? 'flash-down' : ''}`}>{children}</Tag>;
}

/** ▲ / ▼ for the last price move. */
export function TickArrow({ dir }) {
  if (!dir) return null;
  return <span className={`ml-0.5 text-[9px] ${dir === 'up' ? 'text-accent' : 'text-red'}`} aria-label={dir === 'up' ? 'up' : 'down'}>{dir === 'up' ? '▲' : '▼'}</span>;
}

/** A number that rolls smoothly to its new value instead of jumping (for slow-moving totals). */
export function RollingNumber({ value, format = v => v.toFixed(2), duration = 600 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value), raf = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(value)) { setShown(value); return; }
    const start = performance.now(), a = Number.isFinite(from.current) ? from.current : value;
    cancelAnimationFrame(raf.current);
    const step = t => {
      const k = Math.min(1, (t - start) / duration), e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      setShown(v); from.current = v;
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <>{Number.isFinite(shown) ? format(shown) : '—'}</>;
}
