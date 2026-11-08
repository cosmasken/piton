const EXPLORER = 'https://explorer.test.mezo.org/tx/';

// Map known revert reasons to plain English
const REVERT_MAP = {
  'Option is out of the money':              'Option is out of the money — current price does not make this profitable to settle.',
  'Only long party can settle':              'Only the buyer (long party) can settle this option.',
  'Insufficient MUSD approved for strike':   'Approve more MUSD before settling — the strike payment was not approved.',
  'Incorrect BTC amount sent':               'Wrong BTC amount sent. Check the quantity.',
  'Stale price':                             'The on-chain oracle price is stale (>2h old). Try again shortly.',
  'Invalid price':                           'Oracle returned an invalid price. Try again shortly.',
  'Trove equity insufficient':               'Your Mezo Trove does not have enough equity to cover this margin.',
  'Cannot fill your own order':              'You cannot fill your own order.',
  'Wrong option selected':                   'This order requires the opposite position.',
  'Insufficient MUSD approved for premium':  'Approve MUSD before filling — the premium was not approved.',
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
  return { hash, explorerUrl: `${EXPLORER}${hash}` };
}
