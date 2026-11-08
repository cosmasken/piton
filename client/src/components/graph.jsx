import React, { useState, useEffect } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function Graph() {
  const [candles, setCandles] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await (await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=48')).json();
        setCandles(raw.map(k => ({
          t:    new Date(k[0]).getHours() + ':00',
          o:    parseFloat(k[1]),
          h:    parseFloat(k[2]),
          l:    parseFloat(k[3]),
          c:    parseFloat(k[4]),
          bull: parseFloat(k[4]) >= parseFloat(k[1]),
        })));
      } catch {}
    })();
  }, []);

  if (!candles.length) return <div className="panel flex-1 flex items-center justify-center text-dim text-xs">Loading chart…</div>;

  // recharts doesn't have a native candlestick — encode as stacked bar: [low, open/close body, high]
  const data = candles.map(c => ({
    t:      c.t,
    bull:   c.bull,
    wick_l: c.l,                                    // bottom wick base
    body:   [Math.min(c.o, c.c), Math.max(c.o, c.c)], // [bodyLow, bodyHigh]
    wick_h: c.h,
  }));

  const CustomBar = (props) => {
    const { x, y, width, height, bull } = props;
    const color = bull ? '#00ff88' : '#ff4466';
    return <rect x={x + width * 0.2} y={y} width={width * 0.6} height={Math.max(height, 1)} fill={color} />;
  };

  return (
    <div className="panel flex-1 min-h-0 flex flex-col">
      <div className="panel-header">BTC / USD — 48h</div>
      <div className="flex-1 min-h-0 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" tick={{ fill: '#3a5a3a', fontSize: 10 }} interval={7} axisLine={false} tickLine={false} />
            <YAxis domain={['auto', 'auto']} tick={{ fill: '#3a5a3a', fontSize: 10 }} axisLine={false} tickLine={false} width={60}
              tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: '#3a5a3a' }}
              formatter={(val, name) => name === 'body' ? [`$${val[0].toFixed(0)} – $${val[1].toFixed(0)}`, 'Body'] : null}
            />
            <Bar dataKey="body" shape={<CustomBar />}>
              {data.map((d, i) => <Cell key={i} fill={d.bull ? '#00ff88' : '#ff4466'} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
