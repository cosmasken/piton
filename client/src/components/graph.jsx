import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import {
  createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, LineStyle,
} from 'lightweight-charts';
import { useStore, ADDRESSES } from '../store';
import { INTERVALS, parseKlines, parseKlineMessage, fmtTime, expectedMoveCone, liquidationPrice } from '../chartMath.mjs';
import { expiryLabel } from '../instruments.mjs';
import { bsPrice } from '../greeks';
import { breakEven, PROTOCOL_FEE_BPS } from '../payoff.mjs';
import { MCR } from '../troveProtect.mjs';

const UP = '#00ff88', DOWN = '#ff4466', GRID = '#141414', TEXT = '#6b6b6b';
const STRIKE = '#f5b041', BE = '#e0ffe0', CONE = 'rgba(122,162,255,0.85)';
const IV_KEY = 'piton_chart_interval', OV_KEY = 'piton_chart_overlays';
const OVERLAYS = [
  ['option', 'Selected option', 'Strike, break-even and expiry of the option in the trade form'],
  ['cone', 'Expected move', "About 68% of outcomes at expiry, from the pool's volatility"],
  ['positions', 'My positions', 'A line at each open position, with live P&L. Click one to select it'],
  ['oi', 'Open interest', 'Size of live options at each strike'],
  ['trove', 'Trove liquidation', "Your Mezo Trove's liquidation price"],
  ['breaker', 'Circuit breaker', 'Prices that would pause pool sales (5% move within 10 minutes)'],
];
const DEFAULT_OV = { option: true, cone: true, positions: true, oi: false, trove: true, breaker: false };
const TROVE_ABI = ['function getTroveStatus(address) view returns (uint256)', 'function getTroveColl(address) view returns (uint256)', 'function getTroveDebt(address) view returns (uint256)'];

const n0 = v => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n2 = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtE = v => parseFloat(ethers.formatEther(v));
const loadOv = () => { try { return { ...DEFAULT_OV, ...JSON.parse(localStorage.getItem(OV_KEY) || '{}') }; } catch { return DEFAULT_OV; } };

/** Replace a set of price lines on a series. */
function setLines(series, ref, specs) {
  for (const l of ref.current) { try { series.removePriceLine(l); } catch { /* already gone */ } }
  ref.current = specs.map(s => series.createPriceLine({ lineWidth: 1, axisLabelVisible: true, ...s }));
}

/** BTC price chart: Binance BTCUSDT candles (history over REST, live candle over websocket) with options overlays. */
export default function Graph() {
  const { btcPrice, selected, setSelected, tradeLeg, poolParams, options, account, provider, chainId } = useStore();
  const box = useRef(null);
  const chartRef = useRef(null);
  const series = useRef({});
  const oracleLine = useRef(null);
  const optionLines = useRef([]), positionLines = useRef([]), troveLines = useRef([]), breakerLines = useRef([]);
  const positionsRef = useRef([]);
  const lastCandle = useRef(null);
  const [interval, setIntervalKey] = useState(() => localStorage.getItem(IV_KEY) || '1h');
  const [state, setState] = useState('loading'); // loading | ready | error
  const [legend, setLegend] = useState(null);
  const [live, setLive] = useState(false);
  const [reload, setReload] = useState(0);
  const [ov, setOv] = useState(loadOv);
  const [menu, setMenu] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0); // re-position HTML overlays after zoom/scroll/resize
  const [candleTick, setCandleTick] = useState(0); // a new candle started: the cone moves with it
  const [trove, setTrove] = useState(null);

  const iv = INTERVALS.find(i => i.key === interval) || INTERVALS[2];
  useEffect(() => { try { localStorage.setItem(OV_KEY, JSON.stringify(ov)); } catch { /* ignore */ } }, [ov]);

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
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    // expected-move cone (two lines into the future) and a full-height bar marking expiry
    const coneOpts = { color: CONE, lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    const coneUp = chart.addSeries(LineSeries, coneOpts);
    const coneDn = chart.addSeries(LineSeries, coneOpts);
    const expiry = chart.addSeries(HistogramSeries, { priceScaleId: 'exp', color: 'rgba(245,176,65,0.18)', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('exp').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const markers = createSeriesMarkers(coneUp, []);
    series.current = { candles, volume, coneUp, coneDn, expiry, markers };
    chartRef.current = chart;

    chart.subscribeCrosshairMove(param => {
      const c = param?.seriesData?.get(candles);
      setLegend(c && param.time ? { ...c, time: param.time } : null);
    });
    // click near a position line selects that option in the trade panel
    chart.subscribeClick(param => {
      if (!param?.point) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null) return;
      let best = null;
      for (const p of positionsRef.current) {
        const d = Math.abs(p.strike - price);
        if (d <= price * 0.003 && (!best || d < Math.abs(best.strike - price))) best = p;
      }
      if (best) useStore.getState().setSelected({ isCall: best.isCall, strike: best.strike, expiry: best.expiry, side: best.isLong ? 'sell' : 'buy' });
    });
    const bump = () => setLayoutTick(t => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.timeScale().subscribeSizeChange(bump);
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
        const newCandle = !lastCandle.current || c.time > lastCandle.current.time;
        candles.update(c); volume.update(toVol(c)); lastCandle.current = c;
        if (newCandle) setCandleTick(t => t + 1); // the cone starts at the latest candle
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
        setLayoutTick(t => t + 1);
        setCandleTick(t => t + 1);
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

  // ── selected option: strike, break-even, expiry marker and the expected-move cone ──
  const midIv = poolParams?.iv || 0.8;
  const legKey = tradeLeg ? `${tradeLeg.side}|${tradeLeg.premium.toFixed(4)}|${tradeLeg.qty}` : '';
  useEffect(() => {
    const { candles, coneUp, coneDn, expiry, markers } = series.current;
    if (!candles) return;
    const inst = ov.option || ov.cone ? selected : null;
    const last = lastCandle.current;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!inst || state !== 'ready' || !last || !btcPrice || inst.expiry <= nowSec) {
      setLines(candles, optionLines, []); coneUp.setData([]); coneDn.setData([]); expiry.setData([]); markers.setMarkers([]);
      return;
    }
    // break-even from the order in the form, or from fair value if the form has no price yet
    const same = tradeLeg && tradeLeg.isCall === inst.isCall && tradeLeg.strike === inst.strike;
    const leg = same ? tradeLeg : {
      side: 'buy', isCall: inst.isCall, strike: inst.strike, qty: 1, feeBps: PROTOCOL_FEE_BPS, collateral: 1e12,
      premium: bsPrice(inst.isCall, btcPrice, inst.strike, (inst.expiry - nowSec) / 3600, midIv),
    };
    const be = breakEven(leg);
    // a buyer of a call (or a seller of a put) profits above break-even; the other two below it
    const above = (leg.side === 'buy') === inst.isCall;
    setLines(candles, optionLines, ov.option ? [
      { price: inst.strike, color: STRIKE, lineStyle: LineStyle.Dashed, title: `${inst.isCall ? 'Call' : 'Put'} strike` },
      ...(be ? [{ price: be, color: BE, lineStyle: LineStyle.LargeDashed, title: `Break-even · ${leg.side === 'buy' ? 'you' : 'seller'} profit${leg.side === 'buy' ? '' : 's'} ${above ? 'above' : 'below'}` }] : []),
    ] : []);

    const cone = ov.cone ? expectedMoveCone(btcPrice, midIv, last.time, inst.expiry, iv.secs) : { upper: [], lower: [] };
    // the cone's first point is the latest candle; it then runs to expiry
    coneUp.setData(cone.upper); coneDn.setData(cone.lower);
    expiry.setData(ov.option ? [{ time: inst.expiry, value: 1 }] : []);
    markers.setMarkers(ov.option && cone.upper.length ? [{ time: cone.upper[cone.upper.length - 1].time, position: 'aboveBar', color: STRIKE, shape: 'arrowDown', text: `Expiry ${expiryLabel(inst.expiry)}` }] : []);
  }, [selected?.isCall, selected?.strike, selected?.expiry, legKey, Math.round(btcPrice / 25), midIv, ov.option, ov.cone, state, interval, candleTick]); // eslint-disable-line

  // ── my open positions ──
  const positions = useMemo(() => {
    const me = account?.toLowerCase();
    const nowSec = Math.floor(Date.now() / 1000);
    if (!me) return [];
    return options.filter(o => Number(o.status) === 1 && Number(o.expiry) > nowSec &&
      (o.long?.toLowerCase() === me || o.short?.toLowerCase() === me)).map(o => {
      const isCall = Number(o.optionType) === 0, strike = fmtE(o.strike), qty = fmtE(o.quantity), premium = fmtE(o.premium);
      const isLong = o.long?.toLowerCase() === me;
      const mark = btcPrice ? bsPrice(isCall, btcPrice, strike, (Number(o.expiry) - nowSec) / 3600, midIv) * qty : 0;
      const pnl = isLong ? mark - premium : premium * (1 - PROTOCOL_FEE_BPS / 10000) - mark;
      return { isCall, strike, qty, isLong, pnl, expiry: Number(o.expiry) };
    });
  }, [options, account, Math.round(btcPrice / 10), midIv]); // eslint-disable-line
  useEffect(() => {
    positionsRef.current = ov.positions ? positions : [];
    const s = series.current.candles;
    if (!s) return;
    setLines(s, positionLines, ov.positions ? positions.map(p => ({
      price: p.strike, color: p.pnl >= 0 ? UP : DOWN, lineStyle: LineStyle.Solid, axisLabelVisible: false,
      title: `${p.isLong ? 'Long' : 'Short'} ${p.isCall ? 'C' : 'P'} ${p.qty} · ${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}`,
    })) : []);
  }, [positions, ov.positions]);

  // ── Trove liquidation price (wallet's own Mezo Trove) ──
  useEffect(() => {
    let off = false;
    const tm = chainId && ADDRESSES[chainId]?.troveManager;
    if (!ov.trove || !account || !provider || !tm) { setTrove(null); return; }
    const load = async () => {
      try {
        const c = new ethers.Contract(tm, TROVE_ABI, provider);
        if (Number(await c.getTroveStatus(account)) !== 1) { if (!off) setTrove(null); return; }
        const [coll, debt] = await Promise.all([c.getTroveColl(account), c.getTroveDebt(account)]);
        if (!off) setTrove(liquidationPrice(fmtE(coll), fmtE(debt), MCR));
      } catch { if (!off) setTrove(null); }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { off = true; clearInterval(id); };
  }, [ov.trove, account, provider, chainId]);
  useEffect(() => {
    const s = series.current.candles;
    if (!s) return;
    setLines(s, troveLines, trove ? [{ price: trove, color: DOWN, lineWidth: 2, lineStyle: LineStyle.Solid, title: 'Trove liquidation' }] : []);
  }, [trove]);

  // ── circuit breaker band: moves beyond this from the current reference price pause pool sales ──
  useEffect(() => {
    const s = series.current.candles;
    if (!s) return;
    const p = poolParams;
    const active = p && p.cbRefPrice > 0 && Date.now() / 1000 - p.cbRefTime <= p.cbWindow && p.cbMaxMoveBps < 10000;
    const m = active ? p.cbMaxMoveBps / 10000 : 0;
    setLines(s, breakerLines, ov.breaker && active ? [
      { price: p.cbRefPrice * (1 + m), color: 'rgba(255,68,102,0.6)', lineStyle: LineStyle.SparseDotted, title: `Breaker +${(m * 100).toFixed(0)}%` },
      { price: p.cbRefPrice * (1 - m), color: 'rgba(255,68,102,0.6)', lineStyle: LineStyle.SparseDotted, title: `Breaker -${(m * 100).toFixed(0)}%` },
    ] : []);
  }, [ov.breaker, poolParams?.cbRefPrice, poolParams?.cbRefTime, poolParams?.cbMaxMoveBps]); // eslint-disable-line

  // ── open interest by strike: horizontal bars beside the price axis (HTML over the canvas) ──
  const oiByStrike = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000), map = {};
    for (const o of options) {
      if (Number(o.status) !== 1 || Number(o.expiry) <= nowSec) continue;
      const k = Math.round(fmtE(o.strike)), side = Number(o.optionType) === 0 ? 'call' : 'put';
      (map[k] ||= { call: 0, put: 0 })[side] += fmtE(o.quantity);
    }
    return map;
  }, [options]);
  const oiBars = useMemo(() => {
    const s = series.current.candles, chart = chartRef.current;
    if (!ov.oi || !s || !chart || state !== 'ready') return [];
    const entries = Object.entries(oiByStrike);
    const max = Math.max(0, ...entries.flatMap(([, v]) => [v.call, v.put]));
    const right = chart.priceScale('right').width();
    return entries.map(([k, v]) => ({ k: Number(k), y: s.priceToCoordinate(Number(k)), ...v, max, right }))
      .filter(b => b.y != null && b.max > 0);
  }, [ov.oi, oiByStrike, layoutTick, state]); // eslint-disable-line

  const c = legend || lastCandle.current;
  const chg = c ? (c.close - c.open) / c.open * 100 : null;
  const anyOverlay = OVERLAYS.filter(([k]) => ov[k]).length;

  return (
    <div className="panel flex-1 min-h-0 flex flex-col">
      <div className="panel-header flex items-center justify-between gap-2 flex-wrap">
        <span className="normal-case tracking-normal">
          <span className="uppercase tracking-widest">BTC / USD</span>
          <span className="ml-2 text-[10px] text-dim">candles: Binance BTCUSDT · settlement: Skip oracle{btcPrice ? ` $${n0(btcPrice)}` : ''}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono ${live ? 'text-accent' : 'text-dim'}`} title={live ? 'Live candle via Binance websocket' : 'Live feed not connected'}>{live ? '● live' : '○'}</span>
          <div className="relative">
            <button onClick={() => setMenu(m => !m)} aria-expanded={menu} className="text-[10px] px-2 py-0.5 rounded border border-border text-dim hover:text-text normal-case tracking-normal">
              Overlays ({anyOverlay}) ▾
            </button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 bg-panel border border-border rounded-md p-2 space-y-1.5 shadow-lg w-64 normal-case tracking-normal" onMouseLeave={() => setMenu(false)}>
                {OVERLAYS.map(([k, label, title]) => (
                  <label key={k} className="flex items-start gap-2 text-xs text-text cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={!!ov[k]} onChange={() => setOv(o => ({ ...o, [k]: !o[k] }))} />
                    <span>{label}<span className="block text-[10px] text-dim">{title}</span></span>
                  </label>
                ))}
              </div>
            )}
          </div>
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
            {selected && ov.cone && <span className="block text-[9px]" style={{ color: CONE }}>- - expected move to expiry (±1σ, {(midIv * 100).toFixed(0)}% vol)</span>}
          </div>
        )}
        {oiBars.map(b => (
          <div key={b.k} className="absolute z-10 pointer-events-none flex items-center gap-px" style={{ top: b.y - 3, right: b.right + 2 }} title={`OI at ${b.k}`}>
            {b.put > 0 && <div className="h-1.5 bg-red/60 rounded-sm" style={{ width: Math.max(3, b.put / b.max * 80) }} />}
            {b.call > 0 && <div className="h-1.5 bg-accent/60 rounded-sm" style={{ width: Math.max(3, b.call / b.max * 80) }} />}
            <span className="text-[9px] font-mono text-dim ml-1">{(b.call + b.put).toFixed(3)}</span>
          </div>
        ))}
        {ov.oi && state === 'ready' && !oiBars.length && <div className="absolute right-20 bottom-8 z-10 text-[10px] text-dim pointer-events-none">No open interest yet</div>}
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
