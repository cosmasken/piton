import { useStore } from './store';
import { expiryLabel, zoneLabel } from './instruments.mjs';

/**
 * How to show times, from Settings ("Times: Local / UTC"). Expiries are one moment for everyone; only the label
 * changes. Instrument names (BTC-12NOV26-74000-P) and links always stay UTC so every user names an option the same.
 */
export function useTimes() {
  const utc = useStore(s => !!s.settings.utc);
  const label = ts => expiryLabel(ts, utc);                       // "12 NOV 11:00"
  const zone = ts => zoneLabel(ts, utc);                          // "UTC+3"
  return {
    utc,
    label,
    zone,
    full: ts => `${label(ts)} ${zone(ts)}`,                       // "12 NOV 11:00 UTC+3"
    /** Tooltip: "Expires 12 NOV 11:00 UTC+3 · 12 NOV 08:00 UTC" (the second part only when it differs). */
    title: ts => {
      const alt = utc ? `${expiryLabel(ts, false)} ${zoneLabel(ts, false)} (your time)` : `${expiryLabel(ts, true)} UTC`;
      const same = zoneLabel(ts, false) === 'UTC';
      return `Expires ${label(ts)} ${zone(ts)}${same ? '' : ` · ${alt}`}`;
    },
    /** Clock time only, e.g. "17:05 UTC+3". */
    clock: ts => `${label(ts).slice(-5)} ${zone(ts)}`,
  };
}
