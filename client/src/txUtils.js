import { explorerTx } from './network.mjs';
import { useStore } from './store';

// Map known revert reasons to plain English
const REVERT_MAP = {
  'Option is out of the money':              'Option is out of the money — current price does not make this profitable to settle.',
  'Only long party can settle':              'Only the buyer (long party) can settle this option.',
  'Insufficient MUSD approved for strike':   'Approve more MUSD before settling — the strike payment was not approved.',
  'Incorrect BTC amount sent':               'Wrong BTC amount sent. Check the quantity.',
  'stale price':                             'The on-chain oracle price is stale (more than 5 minutes old). Try again shortly.',
  'Invalid price':                           'Oracle returned an invalid price. Try again shortly.',
  'Trove equity insufficient':               'Your Mezo Trove does not have enough equity to cover this margin.',
  'Cannot fill your own order':              'You cannot fill your own order.',
  'Wrong option selected':                   'This order requires the opposite position.',
  'Insufficient MUSD approved for premium':  'Approve MUSD before filling — the premium was not approved.',
  'deposit locked':                          'Your deposit is still locked. New deposits are locked for a short time before they can be withdrawn or moved.',
  'circuit breaker':                         'Deposits are paused for a while after a fast price move. Withdrawals and settlement still work.',
  'insufficient liquidity':                  'Not enough unlocked liquidity in the pool right now. Try a smaller amount, or wait for options to expire.',
  'tvl cap':                                 'The pool is at its deposit cap. Try a smaller amount.',
  'paused':                                  'Trading is paused by the pool operator. Withdrawals and settlement still work.',
  'expiry too soon':                         'Expiry is too close. Pick a longer expiry.',
  'not in the money':                        'This option is not in the money right now, so there is nothing to exercise.',
  'not in exercise window':                  'Auto-exercise only runs in the last 5 minutes before expiry.',
  'auto-exercise not enabled':               'The owner has not enabled auto-exercise on this option.',
  'not your open option':                    'Only the owner of a live option can change its auto-exercise setting.',
  'pool insolvent':                          'The pool has no value left; deposits reopen once the operator clears old shares.',
  'no bid':                                  'The pool has no bid for this option right now, or its price moved below your minimum. Only options the pool sold, still live, can be sold back.',
  'only long can sell back':                 'Only the owner of the option can sell it back.',
  'user rejected':                           'Transaction rejected in wallet.',
  'User rejected':                           'Transaction rejected in wallet.',
  'ACTION_REJECTED':                         'Transaction rejected in wallet.',
};

export function parseTxError(err) {
  const raw = err?.reason || err?.message || String(err);
  for (const [key, msg] of Object.entries(REVERT_MAP)) {
    if (raw.includes(key)) return msg;
  }
  // ethers CALL_EXCEPTION — extract revert string if present
  if (raw.includes('CALL_EXCEPTION')) return 'Transaction reverted on-chain. The action may no longer be valid (expired, already settled, or wrong party).';
  if (raw.includes('insufficient funds')) return 'Insufficient BTC for gas.';
  return 'Transaction failed. Check the console for details.';
}

export function txSuccessMsg(hash) {
  return { hash, explorerUrl: explorerTx(useStore.getState().network, hash) };
}
