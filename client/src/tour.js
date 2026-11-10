import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useStore } from './store';
import { getNetwork } from './network.mjs';

const STEPS = [
  {
    element: '[data-tour="market-value"]',
    popover: { title: 'Live BTC Price', description: 'Real-time BTC/USD from the Skip oracle on Mezo, updated every block. Falls back to Binance if the oracle is stale.' },
  },
  {
    element: '[data-tour="new-order"]',
    popover: { title: 'Buy or Sell', description: 'Pick an option in the chain, then Buy (take the pool\'s price now, or set a limit price) or Sell (post collateral and a price). You see the cost, the worst case, the break-even and a payoff chart before you sign.' },
  },
  {
    element: '[data-tour="trove-margin"]',
    popover: { title: 'Trove Margin', description: 'Unique to Piton — use your Mezo Trove equity as collateral for short orders. No capital lockup required.' },
  },
  {
    element: '[data-tour="chart"]',
    popover: { title: 'BTC Chart', description: 'Candlestick, line, or area chart with volume bars. Switch intervals between 1h, 4h, and 1d. The dashed line shows the current oracle price.' },
  },
  {
    element: '[data-tour="open-orders"]',
    popover: { title: 'Option Chain', description: 'Choose an expiry, then click an ask to buy or a bid to sell. Calls are on the left, puts on the right. A dot marks the pool\'s own price. Other tabs list every resting order and recent trades.' },
  },
  {
    element: '[data-tour="wallet"]',
    popover: { title: 'Your Wallet', description: 'Live BTC and MUSD balances. You need MUSD to buy options or post margin — borrow it on Mezo.' },
  },
  {
    element: '[data-tour="your-orders"]',
    popover: { title: 'Your Positions', description: 'Open positions with live profit and loss, break-even and a payoff chart (click a row). Exercise a winning option, turn on auto-exercise, cancel a resting order, or refund after expiry.' },
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
