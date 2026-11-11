import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, DEFAULT_SETTINGS } from '../store';
import Modal from './Modal';

/** Trading preferences, saved in this browser. */
export default function Settings({ onClose }) {
  const { settings, setSettings } = useStore(useShallow(s => ({ settings: s.settings, setSettings: s.setSettings })));
  const [d, setD] = useState(settings);
  const [note, setNote] = useState('');
  const upd = patch => setD(x => ({ ...x, ...patch }));

  const toggleNotify = async on => {
    if (!on) { upd({ notify: false }); return; }
    if (typeof Notification === 'undefined') { setNote('This browser does not support notifications.'); return; }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'granted') { upd({ notify: true }); setNote(''); } else setNote('Notifications are blocked for this site in your browser settings.');
  };
  const save = () => {
    const size = parseFloat(d.defaultSize), slip = parseFloat(d.slippagePct), mins = parseInt(d.alertMinutes, 10);
    if (!(size > 0)) return setNote('Default size must be above 0.');
    if (!(slip >= 0.1 && slip <= 10)) return setNote('Sell-back slippage must be between 0.1% and 10%.');
    if (!(mins >= 5 && mins <= 1440)) return setNote('Alert window must be between 5 minutes and 24 hours.');
    setSettings({ ...d, defaultSize: String(size), slippagePct: slip, alertMinutes: mins });
    onClose();
  };
  const field = 'input-field';
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-3 text-xs">
        <label className="block"><span className="text-dim">Default order size (BTC)</span>
          <input className={field} type="number" step="any" min="0" value={d.defaultSize} onChange={e => upd({ defaultSize: e.target.value })} /></label>
        <label className="block"><span className="text-dim">Price unit (option chain and order form)</span>
          <select className={field} value={d.priceUnit} onChange={e => upd({ priceUnit: e.target.value })}>
            <option value="musd">MUSD per BTC</option><option value="btc">BTC (chain only; the form uses MUSD)</option><option value="pct">% of spot</option>
          </select></label>
        <label className="block"><span className="text-dim">Sell-back slippage: accept a pool bid up to this much below the quote (%)</span>
          <input className={field} type="number" step="0.1" min="0.1" max="10" value={d.slippagePct} onChange={e => upd({ slippagePct: e.target.value })} /></label>
        <label className="block"><span className="text-dim">Warn about in-the-money options this long before expiry (minutes)</span>
          <input className={field} type="number" step="5" min="5" max="1440" value={d.alertMinutes} onChange={e => upd({ alertMinutes: e.target.value })} /></label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!d.notify} onChange={e => toggleNotify(e.target.checked)} />
          <span>Browser notification for those warnings (while this tab is open)</span></label>
        {note && <p className="text-yellow-400" role="status">{note}</p>}
        <p className="text-[10px] text-dim">Saved in this browser only. Keyboard: arrows move around the option chain, B / S pick buy or sell, Enter reviews the order, 1–6 chart interval, F full-screen chart.</p>
        <div className="flex gap-3">
          <button onClick={() => setD({ ...DEFAULT_SETTINGS })} className="btn-ghost flex-1">Reset</button>
          <button onClick={save} className="btn-primary flex-1">Save</button>
        </div>
      </div>
    </Modal>
  );
}
