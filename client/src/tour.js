import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const STEPS = [
  {
    element: '[data-tour="market-value"]',
    popover: { title: 'Live BTC Price', description: 'Real-time BTC/USD from the Skip oracle on Mezo, updated every block. Falls back to Binance if the oracle is stale.' },
  },
  {
    element: '[data-tour="new-order"]',
    popover: { title: 'Place an Order', description: 'Choose Long or Short, Call or Put. Set your strike price, premium, and quantity — then confirm to post to the on-chain order book.' },
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
    popover: { title: 'Order Book', description: 'All open orders on-chain. Click "Fill →" to take the opposite side of any order. Filter by strike range or switch to the Depth view.' },
  },
  {
    element: '[data-tour="wallet"]',
    popover: { title: 'Your Wallet', description: 'Live BTC and MUSD balances. You need MUSD to buy options or post margin — borrow it at testnet.mezo.org.' },
  },
  {
    element: '[data-tour="your-orders"]',
    popover: { title: 'Your Positions', description: 'All your open positions with live P/L, Greeks, and payoff curves. Use Settle to exercise, Close to cancel, or Refund after expiry.' },
  },
];

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
    steps: STEPS,
  });
  d.drive();
}
