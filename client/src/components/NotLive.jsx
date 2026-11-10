import React from 'react';
import { useStore } from '../store';
import { getNetwork, isLive, NETWORKS, DEFAULT_NETWORK } from '../network.mjs';

/** True when Piton's contracts exist on the selected network. */
export function useIsLive() {
  return isLive(getNetwork(useStore(s => s.network)));
}

/** Full-width banner shown above the dashboard while the selected network has no deployment. */
export function NotLiveBanner() {
  const network = useStore(s => s.network);
  const setNetwork = useStore(s => s.setNetwork);
  const net = getNetwork(network);
  if (isLive(net)) return null;
  const fallback = Object.values(NETWORKS).find(isLive) || NETWORKS[DEFAULT_NETWORK];
  return (
    <div role="status" className="shrink-0 flex flex-wrap items-center justify-center gap-3 px-4 py-2.5 bg-yellow-900/40 border-b border-yellow-700/40 text-yellow-300 text-sm font-body">
      <span><strong>Piton is not live on {net.label} yet.</strong> Trading is disabled until launch; prices are live.</span>
      {fallback.key !== net.key && (
        <button type="button" onClick={() => setNetwork(fallback.key)}
          className="px-3 py-1 rounded border border-yellow-600/60 text-yellow-200 text-xs font-display font-semibold hover:bg-yellow-700/30 transition-colors">
          Switch to {fallback.label}
        </button>
      )}
    </div>
  );
}

/**
 * Wraps a trading panel. While not live, the panel is greyed out, can't be clicked or focused,
 * and is labelled for screen readers.
 */
export function LockedWhenNotLive({ children, className = '' }) {
  const live = useIsLive();
  const label = getNetwork(useStore(s => s.network)).label;
  if (live) return <div className={className}>{children}</div>;
  return (
    <div className={`relative ${className}`} aria-disabled="true">
      <div className="opacity-30 pointer-events-none select-none h-full flex flex-col" inert="">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="px-3 py-1.5 rounded border border-yellow-700/50 bg-bg/90 text-yellow-300 text-xs font-display font-semibold">
          Not live on {label}
        </span>
      </div>
    </div>
  );
}
