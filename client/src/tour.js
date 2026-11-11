import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useStore } from './store';
import { getNetwork } from './network.mjs';

const STEPS = [
  {
    element: '[data-tour="market-header"]',
    popover: { title: 'Market at a glance', description: 'BTC index (the Skip oracle price trades settle on), the live Binance price, 24h stats, volume, open interest, the pool\'s volatility against Deribit\'s DVOL, and the latest Mezo block. Everything refreshes every block.' },
  },
  {
    element: '[data-tour="chart"]',
    popover: { title: 'Chart', description: 'Live BTC candles with your selected option\'s strike, break-even, expiry and expected move (Overlays). Other tabs show volatility history, pool history and the payoff of your order. Keys 1-6 change the interval, F goes full screen.' },
  },
  {
    element: '[data-tour="open-orders"]',
    popover: { title: 'Option chain', description: 'Pick an expiry, then click an ask to buy or a bid to sell. Calls on the left, puts on the right; a dot marks the pool\'s price. Keyboard: arrows move, B / S choose the side, Enter reviews the order.' },
  },
  {
    element: '[data-tour="new-order"]',
    popover: { title: 'Trade', description: 'Buy at the pool\'s price or set a limit; sell by posting collateral (MUSD or your Mezo Trove). You see cost, worst case, break-even and a payoff chart before signing. Tick auto-exercise to have winning options exercised for you.' },
  },
  {
    element: '[data-tour="your-orders"]',
    popover: { title: 'Positions', description: 'Open positions with live P&L and portfolio greeks; sell back to the pool, exercise, or cancel. History shows every action with realised P&L, and exports to CSV.' },
  },
  {
    element: '[data-tour="wallet"]',
    popover: { title: 'Account', description: 'Your MUSD and BTC, your pool share, open positions, and open and realised P&L in one place. You need MUSD to trade: borrow it on Mezo.' },
  },
  {
    element: '[data-tour="pool"]',
    popover: { title: 'Pool', description: 'Deposit MUSD to sell options and earn premiums. See utilisation, the pool\'s exposure, and your share and P&L. "How it works" explains the risks.' },
  },
];


// Name the borrow site for the selected network (testnet.mezo.org vs mezo.org/borrow).
function withBorrowLink(steps) {
  const host = getNetwork(useStore.getState().network).borrowUrl.replace(/^https?:\/\//, '');
  return steps.map(s => s.element === '[data-tour="wallet"]'
    ? { ...s, popover: { ...s.popover, description: `Live BTC and MUSD balances. You need MUSD to buy options or post margin — borrow it at ${host}.` } }
    : s);
}

export function startTour() {
  const d = driver({
    animate: true,
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Done',
    overlayColor: '#000',
    overlayOpacity: 0.7,
    popoverClass: 'piton-tour',
    steps: withBorrowLink(STEPS),
  });
  d.drive();
}
