import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode, LineStyle } from 'lightweight-charts';
import { useStore } from '../store';
import { INTERVALS, parseKlines, parseKlineMessage, fmtTime } from '../chartMath.mjs';

const UP = '#00ff88', DOWN = '#ff4466', GRID = '#141414', TEXT = '#6b6b6b';
const IV_KEY = 'piton_chart_interval';
const n0 = v => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** BTC price chart: Binance BTCUSDT candles (history over REST, live candle over websocket). */
export default function Graph() {
  const btcPrice = useStore(s => s.btcPrice);
  const box = useRef(null);
  const chartRef = useRef(null);
  const series = useRef({});
  const oracleLine = useRef(null);
  const lastCandle = useRef(null);
  const [interval, setIntervalKey] = useState(() => localStorage.getItem(IV_KEY) || '1h');
  const [state, setState] = useState('loading'); // loading | ready | error
  const [legend, setLegend] = useState(null);
  const [live, setLive] = useState(false);
  const [reload, setReload] = useState(0);

  const iv = INTERVALS.find(i => i.key === interval) || INTERVALS[2];

  // create the chart once
  useEffect(() => {
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: TEXT, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, attributionLogo: true },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1a1a1a' },
      timeScale: { borderColor: '#1a1a1a', timeVisible: true, secondsVisible: false, rightOffset: 6 },
      localization: { priceFormatter: p => n0(p), timeFormatter: t => fmtTime(t, false) },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    series.current = { candles, volume };
    chartRef.current = chart;

    chart.subscribeCrosshairMove(param => {
      const c = param?.seriesData?.get(candles);
      setLegend(c && param.time ? { ...c, time: param.time } : null);
    });
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // history for the chosen interval, then a live candle from the websocket
  useEffect(() => {
    try { localStorage.setItem(IV_KEY, interval); } catch { /* ignore */ }
    let off = false, ws = null, retry = null, backoff = 1000;
    setState('loading'); setLive(false);
    const { candles, volume } = series.current;
    const toVol = c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(0,255,136,0.25)' : 'rgba(255,68,102,0.25)' });

    const connect = () => {
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/btcusdt@kline_${iv.binance}`);
      ws.onopen = () => { backoff = 1000; if (!off) setLive(true); };
      ws.onmessage = ev => {
        const c = parseKlineMessage(JSON.parse(ev.data));
        if (!c || off) return;
        if (lastCandle.current && c.time < lastCandle.current.time) return; // stale message
        candles.update(c); volume.update(toVol(c)); lastCandle.current = c;
      };
      ws.onclose = () => { if (off) return; setLive(false); retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); };
    };

    (async () => {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${iv.binance}&limit=${iv.limit}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = parseKlines(await r.json());
        if (off) return;
        if (!data.length) throw new Error('no data');
        candles.setData(data); volume.setData(data.map(toVol));
        lastCandle.current = data[data.length - 1];
        // open on the latest ~120 candles; older history is a scroll/zoom away
        chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 120), to: data.length + 6 });
        setState('ready');
        connect();
      } catch { if (!off) setState('error'); }
    })();
    return () => { off = true; clearTimeout(retry); if (ws) { ws.onclose = null; ws.close(); } };
  }, [interval, reload]); // eslint-disable-line

  // settlement price (Skip oracle) as a labelled line; the candles are an exchange price
  useEffect(() => {
    const s = series.current.candles;
    if (!s || !btcPrice) return;
    const opts = { price: btcPrice, color: '#e0ffe0', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Skip' };
    if (oracleLine.current) oracleLine.current.applyOptions(opts);
    else oracleLine.current = s.createPriceLine(opts);
  }, [btcPrice]);

  const c = legend || lastCandle.current;
  const chg = c ? (c.close - c.open) / c.open * 100 : null;

  return (
    <div className="panel flex-1 min-h-0 flex flex-col">
      <div className="panel-header flex items-center justify-between gap-2 flex-wrap">
        <span className="normal-case tracking-normal">
          <span className="uppercase tracking-widest">BTC / USD</span>
          <span className="ml-2 text-[10px] text-dim">candles: Binance BTCUSDT · settlement: Skip oracle{btcPrice ? ` $${n0(btcPrice)}` : ''}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono ${live ? 'text-accent' : 'text-dim'}`} title={live ? 'Live candle via Binance websocket' : 'Live feed not connected'}>{live ? '● live' : '○'}</span>
          <div className="flex gap-0.5" role="group" aria-label="Interval">
            {INTERVALS.map(i => (
              <button key={i.key} onClick={() => setIntervalKey(i.key)} aria-pressed={interval === i.key}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${interval === i.key ? 'bg-surface text-text' : 'text-dim hover:text-text'}`}>{i.key}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={box} className="absolute inset-0" />
        {c && state === 'ready' && (
          <div className="absolute left-2 top-1 z-10 pointer-events-none font-mono text-[10px] text-dim">
            {fmtTime(c.time, false)} · O <span className="text-text">{n2(c.open)}</span> H <span className="text-text">{n2(c.high)}</span> L <span className="text-text">{n2(c.low)}</span> C <span className="text-text">{n2(c.close)}</span>
            {' '}<span className={chg >= 0 ? 'text-accent' : 'text-red'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
          </div>
        )}
        {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-dim text-xs">Loading candles…</div>}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-dim text-xs text-center px-6">
            <span>Couldn't load BTC candles from Binance (it may be blocked in your region).</span>
            <span>Settlement still uses the Skip oracle{btcPrice ? `: $${n0(btcPrice)}` : ''}.</span>
            <button onClick={() => setReload(r => r + 1)} className="text-accent mt-1">Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
