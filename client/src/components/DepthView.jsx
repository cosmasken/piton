import React from 'react';
import { ethers } from 'ethers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TYPE } from '../store';

const fmt = v => v == null ? 0 : parseFloat(ethers.formatEther(v));

export default function DepthView({ options }) {
  const map = {};
  options.forEach(o => {
    const k = Math.round(fmt(o.strike) / 1000) * 1000;
    const side = o.optionType === TYPE.CALL ? 'calls' : 'puts';
    map[k] = map[k] || { strike: k, calls: 0, puts: 0 };
    map[k][side] += fmt(o.quantity);
  });
  const data = Object.values(map).sort((a, b) => a.strike - b.strike)
    .map(d => ({ ...d, strike: `$${(d.strike/1000).toFixed(0)}k` }));
  if (!data.length) return <div className="flex items-center justify-center h-full text-dim text-xs">No orders to display</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="strike" tick={{ fill: '#3a5a3a', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#3a5a3a', fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={v => v.toFixed(2)} />
        <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 6, fontSize: 11 }}
          formatter={(v, name) => [v.toFixed(4) + ' BTC', name]} />
        <Bar dataKey="calls" fill="#00ff88" opacity={0.7} radius={[2,2,0,0]} />
        <Bar dataKey="puts"  fill="#ff4466" opacity={0.7} radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
