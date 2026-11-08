import React, { useState, useEffect } from 'react';
import {
  ComposedChart, AreaChart, LineChart,
  Bar, Area, Line, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useStore } from '../store';

const INTERVALS = ['1h', '4h', '1d'];
const TYPES = ['candle', 'line', 'area'];

async function fetchCandles(interval) {
  const limit = interval === '1d' ? 60 : 48;
  const raw = await (await fetch(
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  )).json();
  return raw.map(k => ({
    t:    interval === '1d'
            ? new Date(k[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : new Date(k[0]).getHours() + ':00',
    o:    parseFloat(k[1]),
    h:    parseFloat(k[2]),
    l:    parseFloat(k[3]),
    c:    parseFloat(k[4]),
    v:    parseFloat(k[5]),
    bull: parseFloat(k[4]) >= parseFloat(k[1]),
  }));
}

const axisProps = {
  tick: { fill: '#3a5a3a', fontSize: 10 },
  axisLine: false, tickLine: false,
};
const tooltipStyle = {
  contentStyle: { background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 6, fontSize: 11 },
  labelStyle: { color: '#3a5a3a' },
};

function CandleBar({ x, y, width, height, bull }) {
  const color = bull ? '#00ff88' : '#ff4466';
  return <rect x={x + width * 0.2} y={y} width={width * 0.6} height={Math.max(height, 1)} fill={color} />;
}

export default function Graph() {
  const btcPrice = useStore(s => s.btcPrice);
  const [candles,  setCandles]  = useState([]);
  const [type,     setType]     = useState('candle');
  const [interval, setInterval] = useState('1h');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchCandles(interval).then(setCandles).catch(() => {}).finally(() => setLoading(false));
  }, [interval]);

  const tickInterval = interval === '1d' ? 9 : 7;
  const yFmt = v => `$${(v / 1000).toFixed(0)}k`;

  const candleData = candles.map(c => ({ t: c.t, bull: c.bull, body: [Math.min(c.o, c.c), Math.max(c.o, c.c)], v: c.v }));
  const lineData   = candles.map(c => ({ t: c.t, price: c.c, v: c.v }));

  // volume domain: max 30% of chart height
  const maxVol = Math.max(...candles.map(c => c.v), 1);

  const sharedProps = { margin: { top: 4, right: 4, bottom: 0, left: 0 } };
  const xAxis = <XAxis dataKey="t" {...axisProps} interval={tickInterval} />;
  const yAxis = <YAxis yAxisId="price" domain={['auto', 'auto']} {...axisProps} width={60} tickFormatter={yFmt} />;
  const volAxis = <YAxis yAxisId="vol" orientation="right" domain={[0, maxVol * 4]} hide />;
  const priceRef = btcPrice ? <ReferenceLine yAxisId="price" y={btcPrice} stroke="#3a5a3a" strokeDasharray="3 3" label={{ value: `$${btcPrice.toLocaleString('en-US',{maximumFractionDigits:0})}`, fill: '#3a5a3a', fontSize: 9, position: 'insideTopRight' }} /> : null;

  return (
    <div className="panel flex-1 min-h-0 flex flex-col">
      <div className="panel-header flex items-center justify-between">
        <span>BTC / USD</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {INTERVALS.map(iv => (
              <button key={iv} onClick={() => setInterval(iv)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${interval === iv ? 'bg-surface text-text' : 'text-dim hover:text-text'}`}>{iv}</button>
            ))}
          </div>
          <div className="flex gap-0.5">
            {TYPES.map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono capitalize transition-colors ${type === t ? 'bg-surface text-text' : 'text-dim hover:text-text'}`}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-dim text-xs">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {type === 'candle' ? (
              <ComposedChart data={candleData} {...sharedProps}>
                {xAxis}{yAxis}{volAxis}
                <Tooltip {...tooltipStyle}
                  formatter={(val, name) => name === 'body' ? [`$${val[0].toFixed(0)} – $${val[1].toFixed(0)}`, 'Body'] : name === 'v' ? [val.toFixed(0), 'Vol'] : null} />
                <Bar yAxisId="vol" dataKey="v" fill="#1a2a1a" radius={[1,1,0,0]} />
                <Bar yAxisId="price" dataKey="body" shape={<CandleBar />}>
                  {candleData.map((d, i) => <rect key={i} fill={d.bull ? '#00ff88' : '#ff4466'} />)}
                </Bar>
                {priceRef}
              </ComposedChart>
            ) : type === 'line' ? (
              <ComposedChart data={lineData} {...sharedProps}>
                {xAxis}{yAxis}{volAxis}
                <Tooltip {...tooltipStyle} formatter={(v, n) => n === 'price' ? [`$${v.toFixed(0)}`, 'Price'] : [v.toFixed(0), 'Vol']} />
                <Bar yAxisId="vol" dataKey="v" fill="#1a2a1a" radius={[1,1,0,0]} />
                <Line yAxisId="price" type="monotone" dataKey="price" dot={false} strokeWidth={1.5} stroke="#00ff88" />
                {priceRef}
              </ComposedChart>
            ) : (
              <ComposedChart data={lineData} {...sharedProps}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00ff88" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {xAxis}{yAxis}{volAxis}
                <Tooltip {...tooltipStyle} formatter={(v, n) => n === 'price' ? [`$${v.toFixed(0)}`, 'Price'] : [v.toFixed(0), 'Vol']} />
                <Bar yAxisId="vol" dataKey="v" fill="#1a2a1a" radius={[1,1,0,0]} />
                <Area yAxisId="price" type="monotone" dataKey="price" dot={false} strokeWidth={1.5} stroke="#00ff88" fill="url(#areaGrad)" />
                {priceRef}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
