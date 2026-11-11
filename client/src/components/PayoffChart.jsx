import React, { lazy, Suspense } from 'react';

// The payoff chart uses Recharts (~530 KB). Load it the first time a payoff is shown, not with the page.
const Impl = lazy(() => import('./PayoffChartImpl'));

export default function PayoffChart(props) {
  const h = props.height ?? 110;
  return (
    <Suspense fallback={<div style={{ height: h }} className="flex items-center justify-center text-[10px] text-dim">Loading chart…</div>}>
      <Impl {...props} />
    </Suspense>
  );
}
