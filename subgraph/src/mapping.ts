import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  OptionPool,
  OrderCreated,
  OrderFilled,
  Settled,
  Refunded,
  Cancelled,
  SoldBack,
  AutoExerciseSet,
  Deposited,
  Withdrawn,
  IVUpdated,
  BreakerTripped,
  Savings,
} from "../generated/OptionPool/OptionPool";
import { ERC20 } from "../generated/OptionPool/ERC20";
import {
  Option,
  Trade,
  Activity,
  Account,
  Pool,
  PoolHourSnapshot,
  PoolDaySnapshot,
  IvUpdate,
  BreakerTrip,
} from "../generated/schema";

// ─── helpers ──────────────────────────────────────────────────────────────────

const ZERO = BigDecimal.fromString("0");
const WAD = BigInt.fromI32(10).pow(18).toBigDecimal();
const POOL_ID = "pool";

function dec(v: BigInt): BigDecimal {
  return v.toBigDecimal().div(WAD);
}

function eventId(e: ethereum.Event): string {
  return e.transaction.hash.toHexString() + "-" + e.logIndex.toString();
}

function account(addr: Address): Account {
  let a = Account.load(addr.toHexString());
  if (a == null) {
    a = new Account(addr.toHexString());
    a.deposited = ZERO;
    a.withdrawn = ZERO;
    a.premiumPaid = ZERO;
    a.payoutsReceived = ZERO;
    a.tradeCount = 0;
    a.save();
  }
  return a;
}

function statusName(s: i32): string {
  if (s == 0) return "OPEN";
  if (s == 1) return "FILLED";
  if (s == 2) return "SETTLED";
  if (s == 3) return "REFUNDED";
  return "CLOSED";
}

/** Copy the contract's view of an option into the entity (strike, size, premium, collateral, parties). */
function syncOption(o: Option, pool: OptionPool, id: BigInt): void {
  let r = pool.try_getOption(id);
  if (r.reverted) return;
  let v = r.value;
  if (v.optionType == 0) o.optionType = "CALL";
  else o.optionType = "PUT";
  o.strike = dec(v.strike);
  o.quantity = dec(v.quantity);
  o.premium = dec(v.premium);
  o.expiry = v.expiry;
  o.collateral = dec(v.collateral);
  o.filledByPool = v.filledByPool;
  if (v.long != Address.zero()) o.long = account(v.long).id;
  if (v.short != Address.zero()) o.short = v.short;
}

/** Pool singleton refreshed from the contract after every event, plus the hour and day snapshots. */
function refreshPool(e: ethereum.Event): Pool {
  let c = OptionPool.bind(e.address);
  let p = Pool.load(POOL_ID);
  if (p == null) {
    p = new Pool(POOL_ID);
    p.address = e.address;
    p.tradeCount = 0;
    p.volumeQuantity = ZERO;
    p.volumePremium = ZERO;
    p.payouts = ZERO;
    p.breakerTrips = 0;
    p.totalAssets = ZERO;
    p.lockedCollateral = ZERO;
    p.netAssetValue = ZERO;
    p.shareSupply = ZERO;
    p.sharePrice = BigDecimal.fromString("1");
    p.iv = ZERO;
    p.openPoolOptions = 0;
    p.premiumsEarned = ZERO;
    p.settlementsPaid = ZERO;
    p.savingsYield = ZERO;
    p.performanceFees = ZERO;
    p.invested = ZERO;
  }
  let ta = c.try_totalAssets();
  if (!ta.reverted) p.totalAssets = dec(ta.value);
  let lc = c.try_lockedCollateral();
  if (!lc.reverted) p.lockedCollateral = dec(lc.value);
  let nav = c.try_netAssetValue();
  if (!nav.reverted) p.netAssetValue = dec(nav.value);
  let iv = c.try_iv();
  if (!iv.reverted) p.iv = dec(iv.value);
  let pe = c.try_totalPremiumsEarned();
  if (!pe.reverted) p.premiumsEarned = dec(pe.value);
  let sp = c.try_totalSettlementsPaid();
  if (!sp.reverted) p.settlementsPaid = dec(sp.value);
  let sy = c.try_totalSavingsYield();
  if (!sy.reverted) p.savingsYield = dec(sy.value);
  let pf = c.try_totalPerformanceFeePaid();
  if (!pf.reverted) p.performanceFees = dec(pf.value);
  let inv = c.try_invested();
  if (!inv.reverted) p.invested = dec(inv.value);
  let open = c.try_openPoolOptionCount();
  if (!open.reverted) p.openPoolOptions = open.value.toI32();
  let y = c.try_ymusd();
  if (!y.reverted) {
    let supply = ERC20.bind(y.value).try_totalSupply();
    if (!supply.reverted) {
      p.shareSupply = dec(supply.value);
      if (p.shareSupply.gt(ZERO)) p.sharePrice = p.netAssetValue.div(p.shareSupply);
      else p.sharePrice = BigDecimal.fromString("1");
    }
  }
  p.updatedAt = e.block.timestamp;
  p.save();
  return p;
}

function hourSnap(e: ethereum.Event, p: Pool): PoolHourSnapshot {
  let start = e.block.timestamp.div(BigInt.fromI32(3600)).times(BigInt.fromI32(3600));
  let s = PoolHourSnapshot.load(start.toString());
  if (s == null) {
    s = new PoolHourSnapshot(start.toString());
    s.periodStart = start;
    s.trades = 0;
    s.volumeQuantity = ZERO;
    s.volumePremium = ZERO;
    s.payouts = ZERO;
    s.deposits = ZERO;
    s.withdrawals = ZERO;
  }
  s.totalAssets = p.totalAssets;
  s.lockedCollateral = p.lockedCollateral;
  s.netAssetValue = p.netAssetValue;
  s.sharePrice = p.sharePrice;
  s.iv = p.iv;
  s.premiumsEarned = p.premiumsEarned;
  s.settlementsPaid = p.settlementsPaid;
  s.savingsYield = p.savingsYield;
  s.performanceFees = p.performanceFees;
  return s;
}

function daySnap(e: ethereum.Event, p: Pool): PoolDaySnapshot {
  let start = e.block.timestamp.div(BigInt.fromI32(86400)).times(BigInt.fromI32(86400));
  let s = PoolDaySnapshot.load(start.toString());
  if (s == null) {
    s = new PoolDaySnapshot(start.toString());
    s.periodStart = start;
    s.trades = 0;
    s.volumeQuantity = ZERO;
    s.volumePremium = ZERO;
    s.payouts = ZERO;
    s.deposits = ZERO;
    s.withdrawals = ZERO;
  }
  s.totalAssets = p.totalAssets;
  s.lockedCollateral = p.lockedCollateral;
  s.netAssetValue = p.netAssetValue;
  s.sharePrice = p.sharePrice;
  s.iv = p.iv;
  s.premiumsEarned = p.premiumsEarned;
  s.settlementsPaid = p.settlementsPaid;
  s.savingsYield = p.savingsYield;
  s.performanceFees = p.performanceFees;
  return s;
}

/** Refresh pool state and add this event's flows to the hour and day snapshots. */
function record(e: ethereum.Event, trades: i32, qty: BigDecimal, premium: BigDecimal,
                payouts: BigDecimal, deposits: BigDecimal, withdrawals: BigDecimal): void {
  let p = refreshPool(e);
  if (trades > 0 || payouts.gt(ZERO)) {
    p.tradeCount = p.tradeCount + trades;
    p.volumeQuantity = p.volumeQuantity.plus(qty);
    p.volumePremium = p.volumePremium.plus(premium);
    p.payouts = p.payouts.plus(payouts);
    p.save();
  }
  let h = hourSnap(e, p);
  h.trades = h.trades + trades;
  h.volumeQuantity = h.volumeQuantity.plus(qty);
  h.volumePremium = h.volumePremium.plus(premium);
  h.payouts = h.payouts.plus(payouts);
  h.deposits = h.deposits.plus(deposits);
  h.withdrawals = h.withdrawals.plus(withdrawals);
  h.save();
  let d = daySnap(e, p);
  d.trades = d.trades + trades;
  d.volumeQuantity = d.volumeQuantity.plus(qty);
  d.volumePremium = d.volumePremium.plus(premium);
  d.payouts = d.payouts.plus(payouts);
  d.deposits = d.deposits.plus(deposits);
  d.withdrawals = d.withdrawals.plus(withdrawals);
  d.save();
}

function activity(e: ethereum.Event, kind: string, who: Address, optionId: string,
                  amount: BigDecimal, shares: BigDecimal): void {
  let a = new Activity(eventId(e));
  a.kind = kind;
  a.account = account(who).id;
  if (optionId.length > 0) a.option = optionId;
  a.amount = amount;
  if (kind == "DEPOSIT" || kind == "WITHDRAW") a.shares = shares;
  a.timestamp = e.block.timestamp;
  a.tx = e.transaction.hash;
  a.save();
}

// ─── option lifecycle ─────────────────────────────────────────────────────────

export function handleOrderCreated(e: OrderCreated): void {
  let id = e.params.id;
  let o = new Option(id.toString());
  if (e.params.optionType == 0) o.optionType = "CALL";
  else o.optionType = "PUT";
  o.strike = ZERO;
  o.quantity = ZERO;
  o.premium = ZERO;
  o.expiry = BigInt.zero();
  o.collateral = ZERO;
  o.status = "OPEN";
  o.isLongOrder = e.params.isLong;
  o.creator = account(e.params.creator).id;
  o.filledByPool = false;
  o.autoExercise = false;
  o.payout = ZERO;
  o.createdAt = e.block.timestamp;
  o.createdTx = e.transaction.hash;
  let pool = OptionPool.bind(e.address);
  syncOption(o, pool, id);
  // A long order the pool fills is filled in the same transaction: OrderFilled follows and sets FILLED.
  o.status = "OPEN";
  o.save();
  let locked = o.collateral;
  if (e.params.isLong) locked = o.premium;
  activity(e, "ORDER", e.params.creator, o.id, locked, ZERO);
  record(e, 0, ZERO, ZERO, ZERO, ZERO, ZERO);
}

export function handleOrderFilled(e: OrderFilled): void {
  let o = Option.load(e.params.id.toString());
  if (o == null) return;
  let pool = OptionPool.bind(e.address);
  let r = pool.try_getOption(e.params.id);
  if (r.reverted) return;
  let v = r.value;
  syncOption(o, pool, e.params.id);
  o.status = "FILLED";
  o.filledAt = e.block.timestamp;
  o.save();

  let buyer = account(v.long);
  let t = new Trade(eventId(e));
  t.option = o.id;
  t.optionType = o.optionType;
  t.strike = o.strike;
  t.expiry = o.expiry;
  t.quantity = o.quantity;
  t.premium = o.premium;
  t.pricePerBtc = ZERO;
  if (o.quantity.gt(ZERO)) t.pricePerBtc = o.premium.div(o.quantity);
  t.buyer = buyer.id;
  t.seller = v.short;
  t.byPool = e.params.byPool;
  t.timestamp = e.block.timestamp;
  t.blockNumber = e.block.number;
  t.tx = e.transaction.hash;
  t.save();

  buyer.premiumPaid = buyer.premiumPaid.plus(o.premium);
  buyer.tradeCount = buyer.tradeCount + 1;
  buyer.save();
  // for pool sales the contract reports the pool as the filler: credit the buyer instead
  activity(e, "FILL", e.params.byPool ? v.long : e.params.filler, o.id, o.premium, ZERO);
  record(e, 1, o.quantity, o.premium, ZERO, ZERO, ZERO);
}

function closeWithPayout(e: ethereum.Event, id: BigInt, who: Address, payout: BigDecimal, status: string, kind: string): void {
  let o = Option.load(id.toString());
  if (o != null) {
    o.status = status;
    o.payout = payout;
    o.closedAt = e.block.timestamp;
    o.save();
  }
  let a = account(who);
  a.payoutsReceived = a.payoutsReceived.plus(payout);
  a.save();
  activity(e, kind, who, id.toString(), payout, ZERO);
  record(e, 0, ZERO, ZERO, payout, ZERO, ZERO);
}

export function handleSettled(e: Settled): void {
  closeWithPayout(e, e.params.id, e.params.long, dec(e.params.profit), "SETTLED", "EXERCISE");
}

export function handleSoldBack(e: SoldBack): void {
  closeWithPayout(e, e.params.id, e.params.long, dec(e.params.payout), "CLOSED", "SELL_BACK");
}

export function handleRefunded(e: Refunded): void {
  let o = Option.load(e.params.id.toString());
  if (o != null) {
    o.status = "REFUNDED";
    o.closedAt = e.block.timestamp;
    o.save();
  }
  let returned = ZERO;
  if (o != null) returned = o.collateral;
  activity(e, "REFUND", e.params.short, e.params.id.toString(), returned, ZERO);
  record(e, 0, ZERO, ZERO, ZERO, ZERO, ZERO);
}

export function handleCancelled(e: Cancelled): void {
  let o = Option.load(e.params.id.toString());
  if (o != null) {
    o.status = "CANCELLED";
    o.closedAt = e.block.timestamp;
    o.save();
  }
  let amount = ZERO;
  if (o != null) {
    if (o.isLongOrder) amount = o.premium;
    else amount = o.collateral;
  }
  activity(e, "CANCEL", e.params.by, e.params.id.toString(), amount, ZERO);
  record(e, 0, ZERO, ZERO, ZERO, ZERO, ZERO);
}

export function handleAutoExerciseSet(e: AutoExerciseSet): void {
  let o = Option.load(e.params.id.toString());
  if (o == null) return;
  o.autoExercise = e.params.on;
  o.save();
}

// ─── pool ─────────────────────────────────────────────────────────────────────

export function handleDeposited(e: Deposited): void {
  let amount = dec(e.params.musdIn);
  let a = account(e.params.user);
  a.deposited = a.deposited.plus(amount);
  a.save();
  activity(e, "DEPOSIT", e.params.user, "", amount, dec(e.params.sharesOut));
  record(e, 0, ZERO, ZERO, ZERO, amount, ZERO);
}

export function handleWithdrawn(e: Withdrawn): void {
  let amount = dec(e.params.musdOut);
  let a = account(e.params.user);
  a.withdrawn = a.withdrawn.plus(amount);
  a.save();
  activity(e, "WITHDRAW", e.params.user, "", amount, dec(e.params.sharesIn));
  record(e, 0, ZERO, ZERO, ZERO, ZERO, amount);
}

export function handleIVUpdated(e: IVUpdated): void {
  let u = new IvUpdate(eventId(e));
  u.iv = dec(e.params.iv);
  u.by = e.params.by;
  u.timestamp = e.block.timestamp;
  u.tx = e.transaction.hash;
  u.save();
  record(e, 0, ZERO, ZERO, ZERO, ZERO, ZERO);
}

export function handleBreakerTripped(e: BreakerTripped): void {
  let b = new BreakerTrip(eventId(e));
  b.price = dec(e.params.price);
  b.refPrice = dec(e.params.refPrice);
  b.until = e.params.until;
  b.timestamp = e.block.timestamp;
  b.tx = e.transaction.hash;
  b.save();
  let p = refreshPool(e);
  p.breakerTrips = p.breakerTrips + 1;
  p.save();
}

/** Spare MUSD moved into or out of Mezo savings (and any yield brought in): refresh share price and totals. */
export function handleSavings(e: Savings): void {
  record(e, 0, ZERO, ZERO, ZERO, ZERO, ZERO);
}
