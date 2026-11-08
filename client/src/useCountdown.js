import { useState, useEffect } from 'react';

export function useCountdown(expTs) {
  const calc = () => {
    const secs = Number(expTs) - Math.floor(Date.now() / 1000);
    if (secs <= 0) return 'Expired';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const [label, setLabel] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setLabel(calc()), 60_000);
    return () => clearInterval(id);
  }, [expTs]); // eslint-disable-line
  return label;
}
