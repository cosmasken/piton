import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { useNow } from '../useNow';
import { livePositions, expiryAlerts } from '../portfolio.mjs';
import { instrumentName } from '../instruments.mjs';
import { parseTxError } from '../txUtils';

const fmtLeft = s => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`);

/**
 * Warns when an option you hold is in the money, close to expiry, and auto-exercise is off: if nobody
 * exercises it before expiry, its value is lost. Optional browser notification (Settings).
 */
export default function ExpiryAlerts() {
  const { account, options, btcPrice, poolParams, autoEx, settings, poolContract, refresh, fetchAutoEx } = useStore(useShallow(s => ({
    account: s.account, options: s.options, btcPrice: s.btcPrice, poolParams: s.poolParams, autoEx: s.autoEx,
    settings: s.settings, poolContract: s.poolContract, refresh: s.refresh, fetchAutoEx: s.fetchAutoEx,
  })));
  const now = useNow(1000);
  const [busy, setBusy] = useState(null);
  const notified = useRef(new Set());
  const iv = poolParams?.iv || 0.8;
  const { rows } = useMemo(() => livePositions(options, account, btcPrice, iv, now), [options, account, btcPrice, iv, Math.floor(now / 5)]); // eslint-disable-line
  const alerts = expiryAlerts(rows, autoEx, now, (settings.alertMinutes || 60) * 60);

  // one browser notification per option, if the user turned them on
  useEffect(() => {
    if (!settings.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const a of alerts) {
      const key = String(a.id);
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      try {
        new Notification('Piton: option in the money near expiry', {
          body: `${instrumentName(a)} is worth about ${a.intrinsic.toFixed(2)} MUSD and expires in ${fmtLeft(a.expiry - now)}. Exercise it or turn on auto-exercise.`,
          tag: `piton-${key}`,
        });
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [alerts.map(a => String(a.id)).join(','), settings.notify]); // eslint-disable-line

  if (!alerts.length) return null;
  const act = async (id, fn, msg) => {
    setBusy(id);
    try { await (await fn()).wait(); refresh(); fetchAutoEx(); toast.success(msg); } catch (e) { toast.error(parseTxError(e)); } finally { setBusy(null); }
  };
  return (
    <div role="alert" className="shrink-0 px-4 py-2 bg-yellow-900/40 border-b border-yellow-700/40 text-yellow-300 text-xs space-y-1">
      {alerts.map(a => (
        <div key={String(a.id)} className="flex flex-wrap items-center gap-2">
          <span>⏰ <strong className="font-mono">{instrumentName(a)}</strong> is in the money (about {a.intrinsic.toFixed(2)} MUSD) and expires in <span className="font-mono">{fmtLeft(a.expiry - now)}</span>. Auto-exercise is off: exercise it before expiry or its value is lost.</span>
          {poolContract && <>
            <button disabled={busy != null} onClick={() => act(a.id, () => poolContract.settle(a.id), 'Exercised.')} className="px-2 py-0.5 rounded border border-yellow-600/60 hover:bg-yellow-700/30 disabled:opacity-50">{busy === a.id ? '…' : 'Exercise now'}</button>
            <button disabled={busy != null} onClick={() => act(a.id, () => poolContract.setAutoExercise(a.id, true), 'Auto-exercise on.')} className="px-2 py-0.5 rounded border border-yellow-600/60 hover:bg-yellow-700/30 disabled:opacity-50">Turn on auto-exercise</button>
          </>}
        </div>
      ))}
    </div>
  );
}
