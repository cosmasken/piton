import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { payoffCurve } from '../payoff.mjs';

/** Profit and loss at expiry for one position, with spot marked. `leg` is as in payoff.mjs. */
export default function PayoffChart({ leg, spot, height = 110 }) {
  const data = useMemo(() => (leg && spot ? payoffCurve(leg, spot) : []), [leg, spot]);
  if (!data.length) return null;
  const split = (() => {                                   // where the line crosses zero, for the green/red fill
    const lo = Math.min(...data.map(d => d.pnl)), hi = Math.max(...data.map(d => d.pnl));
    return hi <= 0 ? 0 : lo >= 0 ? 1 : hi / (hi - lo);
  })();
  return (
    <div style={{ height }} aria-label="Profit and loss at expiry">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="#00ff88" stopOpacity={0.35} />
              <stop offset={split} stopColor="#00ff88" stopOpacity={0.05} />
              <stop offset={split} stopColor="#ff4466" stopOpacity={0.05} />
              <stop offset={1} stopColor="#ff4466" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <XAxis dataKey="S" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={v => `${Math.round(v / 1000)}k`} interval="preserveStartEnd" />
          <YAxis width={38} tick={{ fill: '#555', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)} />
          <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 6, fontSize: 11 }}
            labelFormatter={v => `BTC at expiry: $${Number(v).toLocaleString()}`}
            formatter={v => [`${v >= 0 ? '+' : ''}${v.toFixed(2)} MUSD`, 'P&L']} />
          <ReferenceLine y={0} stroke="#333" />
          <ReferenceLine x={Math.round(spot)} stroke="#555" strokeDasharray="3 3" />
          <Area type="monotone" dataKey="pnl" stroke="#00ff88" strokeWidth={1.5} fill="url(#pnlFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
