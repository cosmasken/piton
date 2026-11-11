import { createChart, CrosshairMode } from 'lightweight-charts';
import { fmtTime, fmtTick, uniqueByTime } from './chartMath.mjs';

export { uniqueByTime };

export const COLORS = { up: '#00ff88', down: '#ff4466', grid: '#141414', text: '#6b6b6b', strike: '#f5b041', cone: 'rgba(122,162,255,0.85)' };

/**
 * A Lightweight Chart in Piton's dark theme. `utc` controls how times are shown (data is always UTC seconds).
 * The TradingView logo stays on: Lightweight Charts' licence asks for visible attribution.
 */
export function makeChart(el, { utc = false, priceFormatter } = {}) {
  return createChart(el, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: COLORS.text, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, attributionLogo: true },
    grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#1a1a1a' },
    leftPriceScale: { borderColor: '#1a1a1a' },
    timeScale: { borderColor: '#1a1a1a', timeVisible: true, secondsVisible: false, rightOffset: 6, tickMarkFormatter: tickFormatter(utc) },
    localization: { timeFormatter: t => fmtTime(t, utc), ...(priceFormatter ? { priceFormatter } : {}) },
  });
}

/** Map Lightweight Charts' tick mark types (0 year, 1 month, 2 day of month, 3 time, 4 time with seconds) to labels. */
export function tickFormatter(utc) {
  return (time, type) => fmtTick(Number(time), utc, type === 0 ? 'year' : type === 1 ? 'month' : type === 2 ? 'day' : 'time');
}
