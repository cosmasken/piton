// Generated from contracts/OptionPool.sol custom errors: selector -> { name, message (the reason text the contract used before) }.
// Regenerate when the contract's errors change.
export const POOL_ERRORS = {
 "0xd92e233d": {
  "name": "ZeroAddress",
  "message": "zero address"
 },
 "0x9e87fac8": {
  "name": "Paused",
  "message": "paused"
 },
 "0x00bfc921": {
  "name": "InvalidPrice",
  "message": "invalid price"
 },
 "0x19abf40e": {
  "name": "StalePrice",
  "message": "stale price"
 },
 "0x1f2a2005": {
  "name": "ZeroAmount",
  "message": "zero amount"
 },
 "0xa1ffc2ad": {
  "name": "TvlCap",
  "message": "tvl cap"
 },
 "0x33d35105": {
  "name": "CircuitBreaker",
  "message": "circuit breaker"
 },
 "0x8eede7c2": {
  "name": "PoolInsolventClearOldSharesFirst",
  "message": "pool insolvent: clear old shares first"
 },
 "0x642091aa": {
  "name": "MinDeposit0001MUSD",
  "message": "min deposit 0.001 MUSD"
 },
 "0x9811e0c7": {
  "name": "ZeroShares",
  "message": "zero shares"
 },
 "0xad44c75c": {
  "name": "NoSupply",
  "message": "no supply"
 },
 "0xf38b9b5b": {
  "name": "DepositLocked",
  "message": "deposit locked"
 },
 "0xbb55fd27": {
  "name": "InsufficientLiquidity",
  "message": "insufficient liquidity"
 },
 "0xa127cdac": {
  "name": "PoolHasAssets",
  "message": "pool has assets"
 },
 "0xc9ff9fb6": {
  "name": "HoldersListIncomplete",
  "message": "holders list incomplete"
 },
 "0xa86b6512": {
  "name": "InvalidParams",
  "message": "invalid params"
 },
 "0x7c5a534c": {
  "name": "ExpiryTooSoon",
  "message": "expiry too soon"
 },
 "0x4828eeca": {
  "name": "ExpiryTooFar",
  "message": "expiry too far"
 },
 "0x8f656492": {
  "name": "ZeroCollateralStrikeTooFarOTM",
  "message": "zero collateral: strike too far OTM"
 },
 "0xc24b77a1": {
  "name": "CollateralExceedsMax",
  "message": "collateral exceeds max"
 },
 "0x1bee2bf3": {
  "name": "InvalidTroveSig",
  "message": "invalid trove sig"
 },
 "0x20cc6d87": {
  "name": "MarginBelowRequired",
  "message": "margin below required"
 },
 "0x726b3158": {
  "name": "NoActiveTrove",
  "message": "no active trove"
 },
 "0xafc0f03a": {
  "name": "TroveICRTooLowAfterDraw",
  "message": "trove ICR too low after draw"
 },
 "0x45101617": {
  "name": "TroveDrawShort",
  "message": "trove draw short"
 },
 "0xddafad98": {
  "name": "NotOpen",
  "message": "not open"
 },
 "0xe7653e33": {
  "name": "NotAShortOrder",
  "message": "not a short order"
 },
 "0x203d82d8": {
  "name": "Expired",
  "message": "expired"
 },
 "0xeed90bc4": {
  "name": "CannotSelfFill",
  "message": "cannot self-fill"
 },
 "0x225d6207": {
  "name": "NotALongOrder",
  "message": "not a long order"
 },
 "0x809e686b": {
  "name": "OnlyLongCanSettle",
  "message": "only long can settle"
 },
 "0xb363ee5b": {
  "name": "NotYourOpenOption",
  "message": "not your open option"
 },
 "0x61311384": {
  "name": "AutoExerciseNotEnabled",
  "message": "auto-exercise not enabled"
 },
 "0x6951094a": {
  "name": "NotInExerciseWindow",
  "message": "not in exercise window"
 },
 "0xafa905b8": {
  "name": "Max2Pct",
  "message": "max 2%"
 },
 "0x6cb6fbf0": {
  "name": "NotFilled",
  "message": "not filled"
 },
 "0x1af64ced": {
  "name": "NotInTheMoney",
  "message": "not in the money"
 },
 "0x2bf71c79": {
  "name": "OnlyLongCanSellBack",
  "message": "only long can sell back"
 },
 "0x26ca1de2": {
  "name": "NoBid",
  "message": "no bid"
 },
 "0xd0404f85": {
  "name": "NotExpired",
  "message": "not expired"
 },
 "0x9ef07701": {
  "name": "NotYourOrder",
  "message": "not your order"
 },
 "0x630d2b9e": {
  "name": "BadSavings",
  "message": "bad savings"
 },
 "0xf512b278": {
  "name": "NotKeeper",
  "message": "not keeper"
 },
 "0x342fa66d": {
  "name": "OverCap",
  "message": "over cap"
 },
 "0xc6af7143": {
  "name": "SavingsShort",
  "message": "savings short"
 },
 "0xe0019fef": {
  "name": "NotOwnerOrKeeper",
  "message": "not owner or keeper"
 },
 "0x32c44497": {
  "name": "IvOutOfRange",
  "message": "iv out of range"
 },
 "0xaab02dff": {
  "name": "IvUpdatedTooRecently",
  "message": "iv updated too recently"
 },
 "0x0bc7f419": {
  "name": "IvStepTooLarge",
  "message": "iv step too large"
 },
 "0x273aa4ec": {
  "name": "IntervalTooLong",
  "message": "interval too long"
 },
 "0xc7e95bf9": {
  "name": "StepOutOfRange",
  "message": "step out of range"
 },
 "0x9821c0c9": {
  "name": "SpreadTooHigh",
  "message": "spread too high"
 },
 "0x9fac1777": {
  "name": "Max5Pct",
  "message": "max 5%"
 },
 "0x7458e48b": {
  "name": "Max30Pct",
  "message": "max 30%"
 },
 "0xc659c230": {
  "name": "Max1Pct",
  "message": "max 1%"
 },
 "0x2111a9e0": {
  "name": "BadLimits",
  "message": "bad limits"
 },
 "0xce85caec": {
  "name": "Max50Pct",
  "message": "max 50%"
 },
 "0x966f18e4": {
  "name": "Between10PctAnd100Pct",
  "message": "between 10% and 100%"
 },
 "0x7db3aba7": {
  "name": "OutOfRange",
  "message": "out of range"
 },
 "0x5419376a": {
  "name": "BadWindow",
  "message": "bad window"
 },
 "0xb40f94d2": {
  "name": "BadMove",
  "message": "bad move"
 },
 "0x95209ca0": {
  "name": "BadCooldown",
  "message": "bad cooldown"
 },
 "0xd8c36768": {
  "name": "Max7Days",
  "message": "max 7 days"
 },
 "0x2c49223e": {
  "name": "NotOwnerOrGuardian",
  "message": "not owner or guardian"
 },
 "0x89051165": {
  "name": "RenounceDisabled",
  "message": "renounce disabled"
 }
};

/** The pool revert reason in an ethers error (decoded custom error, or its selector in the revert data), or null. */
export function poolRevertReason(err) {
  const name = err?.revert?.name;
  if (name) { const hit = Object.values(POOL_ERRORS).find(e => e.name === name); if (hit) return hit.message; }
  const raw = [err?.data, err?.info?.error?.data, err?.error?.data, err?.shortMessage, err?.message].filter(Boolean).map(String).join(' ');
  for (const sel of raw.match(/0x[0-9a-fA-F]{8}/g) || []) { const hit = POOL_ERRORS[sel.toLowerCase()]; if (hit) return hit.message; }
  return null;
}
