// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {OptionPool} from "../../contracts/OptionPool.sol";
import {yMUSD} from "../../contracts/yMUSD.sol";
import {MockERC20v2} from "../../contracts/test/MockERC20v2.sol";
import {MockOracle, MockTrove, MockBorrowerOps} from "../../contracts/test/MocksV2.sol";

/// @notice Drives OptionPool through random sequences of every user action plus price moves,
///         time jumps and IV changes. Records "ghost" facts the invariants check after each call.
contract Handler is Test {
    OptionPool public pool;
    yMUSD public y;
    MockERC20v2 public musd;
    MockOracle public oracle;
    MockTrove public trove;
    MockBorrowerOps public bo;

    address[] public actors;
    uint256 public price = 100_000; // whole USD per BTC (MockOracle scales by 1e8)

    // ghosts
    bool public ghost_payoutAboveCollateral;
    bool public ghost_withdrawAboveShare;
    bool public ghost_feeRecipientDecreased;
    bool public ghost_flashExerciseProfit;
    uint256 public ghost_lastFeeBalance;
    mapping(bytes32 => uint256) public calls;

    constructor() {
        musd = new MockERC20v2("MUSD", "MUSD");
        oracle = new MockOracle(int256(price));
        trove = new MockTrove();
        bo = new MockBorrowerOps();
        y = new yMUSD();
        pool = new OptionPool(address(musd), address(y), address(oracle), address(trove), address(bo));
        y.setPool(address(pool)); // this handler is owner + fee recipient

        bo.setMUSD(address(musd));
        musd.mint(address(bo), 1e30); // funds the mock Mezo borrow
        pool.setTVLCap(1e27);
        pool.setDepositLock(0);
        pool.setWithdrawalFeeBps(0);
        pool.setMinPoolExpiry(900);
        pool.setBreaker(600, 50000, 0);
        pool.setMaxOptionCollateral(1e26);

        for (uint256 i = 0; i < 5; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(a);
            musd.mint(a, 1e27);
            vm.prank(a);
            musd.approve(address(pool), type(uint256).max);
            trove.setTrove(a, 1, 1_000e18, 0); // healthy Trove: 1,000 BTC, no debt
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    function _actor(uint256 seed) internal view returns (address) { return actors[seed % actors.length]; }
    function _spot() internal view returns (uint256) { return price * 1e18; }
    function _hasOptions() internal view returns (bool) { return pool.nextId() > 1; }
    function _id(uint256 seed) internal view returns (uint256) { return bound(seed, 1, pool.nextId() - 1); }
    function _strike(uint256 seed) internal view returns (uint256) { return _spot() * bound(seed, 50, 200) / 100; }
    function _qty(uint256 seed) internal pure returns (uint256) { return bound(seed, 1e15, 0.2e18); }
    function _expiry(uint256 seed) internal view returns (uint256) { return block.timestamp + bound(seed, 16 minutes, 14 days); }
    function _required(bool isCall, uint256 strike, uint256 qty) internal view returns (uint256) {
        if (!isCall) return strike * qty / 1e18;
        uint256 cap = _spot() * 3;
        return cap > strike ? (cap - strike) * qty / 1e18 : 0;
    }
    /// mode 0: open ask (short waiting)  1: open bid (long waiting)  2: filled  3: filled & expired
    function _find(uint256 seed, uint8 mode) internal view returns (uint256 id, bool ok) {
        uint256 n = pool.nextId() - 1;
        if (n == 0) return (0, false);
        uint256 start = seed % n;
        for (uint256 j = 0; j < n; j++) {
            uint256 i = (start + j) % n + 1;
            OptionPool.Option memory o = pool.getOption(i);
            bool live = o.expiry > block.timestamp;
            if (mode == 0 && o.status == OptionPool.OrderStatus.OPEN && o.long == address(0) && live) return (i, true);
            if (mode == 1 && o.status == OptionPool.OrderStatus.OPEN && o.short == address(0) && live) return (i, true);
            if (mode == 2 && o.status == OptionPool.OrderStatus.FILLED && live) return (i, true);
            if (mode == 3 && o.status == OptionPool.OrderStatus.FILLED && !live) return (i, true);
        }
        return (0, false);
    }

    /// An actor other than `not`, chosen by seed.
    function _other(uint256 seed, address not_) internal view returns (address a) {
        a = _actor(seed);
        if (a == not_) a = _actor(seed + 1);
    }

    function _trackFees() internal {
        uint256 b = musd.balanceOf(address(this));
        if (b < ghost_lastFeeBalance) ghost_feeRecipientDecreased = true;
        ghost_lastFeeBalance = b;
    }

    // ── LP actions ───────────────────────────────────────────────────────────
    function deposit(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1e15, 1e24);
        vm.prank(a);
        try pool.deposit(amount) { calls["deposit"]++; } catch { revert("action reverted"); }
    }

    function withdraw(uint256 actorSeed, uint256 pct) external {
        address a = _actor(actorSeed);
        uint256 shares = y.balanceOf(a) * bound(pct, 1, 100) / 100;
        if (shares == 0) return;
        uint256 expected = shares * pool.totalAssets() / y.totalSupply();
        uint256 before = musd.balanceOf(a);
        vm.prank(a);
        try pool.withdraw(shares) {
            calls["withdraw"]++;
            if (musd.balanceOf(a) - before > expected) ghost_withdrawAboveShare = true;
        } catch { revert("action reverted"); }
    }

    // ── order creation ───────────────────────────────────────────────────────
    function createLong(uint256 actorSeed, bool isCall, uint256 s, uint256 q, uint256 e, uint256 mult) external {
        address a = _actor(actorSeed);
        uint256 strike = _strike(s); uint256 qty = _qty(q); uint256 exp = _expiry(e);
        uint256 quote;
        try pool.quotePremium(isCall, strike, qty, exp) returns (uint256 v) { quote = v; } catch { return; }
        uint256 premium = quote * bound(mult, 50, 150) / 100;
        if (premium == 0) premium = 1e15;
        vm.prank(a);
        try pool.createLongOrder(isCall ? OptionPool.OptionType.CALL : OptionPool.OptionType.PUT, strike, qty, exp, premium) {
            calls["createLong"]++;
        } catch { revert("action reverted"); }
        _trackFees();
    }

    function createShort(uint256 actorSeed, bool isCall, uint256 s, uint256 q, uint256 e, uint256 premium) external {
        address a = _actor(actorSeed);
        premium = bound(premium, 1e15, 1e22);
        vm.prank(a);
        try pool.createShortOrder(isCall ? OptionPool.OptionType.CALL : OptionPool.OptionType.PUT, _strike(s), _qty(q), _expiry(e), premium) {
            calls["createShort"]++;
        } catch { revert("action reverted"); }
    }

    function createShortTrove(uint256 actorSeed, bool isCall, uint256 s, uint256 q, uint256 e, uint256 premium, uint256 extraPct) external {
        address a = _actor(actorSeed);
        uint256 strike = _strike(s); uint256 qty = _qty(q);
        uint256 req = _required(isCall, strike, qty);
        if (req == 0) return;
        uint256 margin = req + req * bound(extraPct, 0, 10) / 100;
        premium = bound(premium, 1e15, 1e22);
        vm.prank(a);
        try pool.createShortOrderTrove(isCall ? OptionPool.OptionType.CALL : OptionPool.OptionType.PUT, strike, qty, _expiry(e), premium, margin, hex"01", block.timestamp + 1) {
            calls["createShortTrove"]++;
        } catch { revert("action reverted"); }
    }

    // ── fills ────────────────────────────────────────────────────────────────
    function fillLong(uint256 actorSeed, uint256 idSeed) external {
        (uint256 id, bool ok) = _find(idSeed, 0);
        if (!ok) return;
        vm.prank(_other(actorSeed, pool.getOption(id).short));
        try pool.fillLong(id) { calls["fillLong"]++; } catch { revert("action reverted"); }
        _trackFees();
    }

    function fillShort(uint256 actorSeed, uint256 idSeed) external {
        (uint256 id, bool ok) = _find(idSeed, 1);
        if (!ok) return;
        vm.prank(_other(actorSeed, pool.getOption(id).long));
        try pool.fillShort(id) { calls["fillShort"]++; } catch { revert("action reverted"); }
        _trackFees();
    }

    // ── settlement / exits ───────────────────────────────────────────────────
    function settle(uint256 idSeed) external {
        (uint256 id, bool ok) = _find(idSeed, 2);
        if (!ok) return;
        OptionPool.Option memory o = pool.getOption(id);
        // only try in-the-money options (OTM settle is a guaranteed, uninteresting revert)
        uint256 s = _spot();
        if (o.optionType == OptionPool.OptionType.CALL ? s <= o.strike : s >= o.strike) return;
        uint256 before = musd.balanceOf(o.long);
        vm.prank(o.long);
        try pool.settle(id) {
            calls["settle"]++;
            if (musd.balanceOf(o.long) - before > o.collateral) ghost_payoutAboveCollateral = true;
        } catch { revert("action reverted"); }
        _trackFees();
    }

    function refund(uint256 callerSeed, uint256 idSeed) external {
        (uint256 id, bool ok) = _find(idSeed, 3);
        if (!ok) return;
        vm.prank(_actor(callerSeed)); // anyone may refund after expiry
        try pool.refund(id) { calls["refund"]++; } catch { revert("action reverted"); }
        _trackFees();
    }

    function cancel(uint256 idSeed) external {
        if (!_hasOptions()) return;
        uint256 id = _id(idSeed);
        OptionPool.Option memory o = pool.getOption(id);
        address creator = o.short == address(0) ? o.long : (o.long == address(0) ? o.short : address(0));
        if (creator == address(0)) return;
        vm.prank(creator);
        try pool.cancelOrder(id) { calls["cancel"]++; } catch { revert("action reverted"); }
    }

    /// Buy an in-the-money option from the pool at its quote and exercise it immediately. This must
    /// never profit the buyer or cost LPs, whatever the price, strike, size or pool state.
    function buyAndExerciseNow(uint256 actorSeed, bool isCall, uint256 strikeSeed, uint256 qtySeed) external {
        address a = _actor(actorSeed);
        uint256 spot = _spot();
        uint256 strike = isCall ? spot * bound(strikeSeed, 50, 99) / 100 : spot * bound(strikeSeed, 101, 200) / 100;
        uint256 qty = bound(qtySeed, 1e15, 0.05e18);
        uint256 exp = block.timestamp + 16 minutes + 1;
        uint256 quote;
        try pool.quotePremium(isCall, strike, qty, exp) returns (uint256 v) { quote = v; } catch { return; }
        if (quote == 0) return;
        uint256 assetsBefore = pool.totalAssets();
        uint256 perfFeeBefore = pool.totalPerformanceFeePaid();
        uint256 balBefore = musd.balanceOf(a);
        vm.prank(a);
        try pool.createLongOrder(isCall ? OptionPool.OptionType.CALL : OptionPool.OptionType.PUT, strike, qty, exp, quote) {} catch { return; }
        uint256 id = pool.nextId() - 1;
        if (!pool.getOption(id).filledByPool) { // not filled: rests as a bid, nothing to check
            vm.prank(a); pool.cancelOrder(id); return;
        }
        vm.prank(a);
        try pool.settle(id) { calls["buyExercise"]++; } catch { return; }
        if (musd.balanceOf(a) > balBefore) ghost_flashExerciseProfit = true;       // buyer profited
        // LPs lost value to the buyer. The performance fee triggered by this settle (15% of yield
        // from OTHER, earlier options) leaves the pool too, so add it back.
        if (pool.totalAssets() + (pool.totalPerformanceFeePaid() - perfFeeBefore) < assetsBefore) ghost_flashExerciseProfit = true;
        _trackFees();
    }

    // ── market / admin ───────────────────────────────────────────────────────
    function movePrice(uint256 pct) external {
        price = bound(price * bound(pct, 70, 130) / 100, 20_000, 400_000);
        oracle.setPrice(int256(price));
        calls["movePrice"]++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 2 days));
        calls["warp"]++;
    }

    function setIV(uint256 ivSeed) external {
        pool.setIV(bound(ivSeed, 25e16, 15e17));
        calls["setIV"]++;
    }
}

contract OptionPoolInvariants is StdInvariant, Test {
    Handler h;
    OptionPool pool;

    function setUp() public {
        h = new Handler();
        pool = h.pool();
        targetContract(address(h));
    }

    /// MUSD owed to individual users (not pool assets), derived from every option's state.
    function _owedToUsers() internal view returns (uint256 owed, uint256 lockedByPool) {
        uint256 n = pool.nextId();
        for (uint256 i = 1; i < n; i++) {
            OptionPool.Option memory o = pool.getOption(i);
            if (o.status == OptionPool.OrderStatus.OPEN) {
                // unfilled long holds the buyer's premium; unfilled short holds the seller's collateral
                owed += o.short == address(0) ? o.premium : o.collateral;
            } else if (o.status == OptionPool.OrderStatus.FILLED) {
                if (o.filledByPool) lockedByPool += o.collateral;
                else owed += o.collateral;
            }
        }
    }

    /// Every MUSD the contract holds is either pool assets or owed to a specific user — exactly.
    function invariant_balanceEqualsAssetsPlusUserFunds() public view {
        (uint256 owed,) = _owedToUsers();
        assertEq(h.musd().balanceOf(address(pool)), pool.totalAssets() + owed, "MUSD balance != totalAssets + user funds");
    }

    /// lockedCollateral is exactly the collateral of open pool-filled options.
    function invariant_lockedCollateralMatchesOpenPoolOptions() public view {
        (, uint256 lockedByPool) = _owedToUsers();
        assertEq(pool.lockedCollateral(), lockedByPool, "lockedCollateral drift");
    }

    /// The pool never owes more than it has, so LP withdrawals can't underflow.
    function invariant_assetsCoverLockedCollateral() public view {
        assertGe(pool.totalAssets(), pool.lockedCollateral(), "totalAssets < lockedCollateral");
    }

    /// No yMUSD can exist without backing assets (the 1:1 dilution case is unreachable).
    function invariant_sharesAreBacked() public view {
        if (h.y().totalSupply() > 0) assertGt(pool.totalAssets(), 0, "shares outstanding with zero assets");
    }

    /// A settlement never pays more than the option's locked collateral.
    function invariant_payoutNeverExceedsCollateral() public view {
        assertFalse(h.ghost_payoutAboveCollateral(), "payout > collateral");
    }

    /// A withdrawal never returns more than the LP's pro-rata share.
    function invariant_withdrawNeverAboveShare() public view {
        assertFalse(h.ghost_withdrawAboveShare(), "withdraw > pro-rata share");
    }

    /// Fees only ever flow to the fee recipient, never out of it.
    function invariant_feesOnlyAccrue() public view {
        assertFalse(h.ghost_feeRecipientDecreased(), "fee recipient balance decreased");
    }

    /// Buying at the quote and exercising at once never profits the buyer or costs LPs.
    function invariant_flashExerciseNeverProfits() public view {
        assertFalse(h.ghost_flashExerciseProfit(), "buy-and-exercise took value from LPs");
    }

    /// Net asset value (what LP shares are redeemed at) never exceeds raw assets, and is never
    /// below assets minus the collateral locked behind open pool options.
    function invariant_navBounds() public view {
        uint256 nav = pool.netAssetValue();
        assertLe(nav, pool.totalAssets(), "NAV > assets");
        assertGe(nav, pool.totalAssets() - pool.lockedCollateral(), "NAV below assets - locked");
    }

    /// Sanity: the fuzzer actually exercised the important paths (printed with -vv).
    function afterInvariant() public {
        string[14] memory k = ["deposit", "withdraw", "createLong", "createShort", "createShortTrove", "fillLong",
            "fillShort", "settle", "refund", "cancel", "movePrice", "warp", "setIV", "buyExercise"];
        for (uint256 i = 0; i < k.length; i++) {
            emit log_named_uint(k[i], h.calls(bytes32(bytes(k[i]))));
        }
    }
}

/// Proves the handler can reach every important path (so the invariants are not passing vacuously):
/// drive it with a deterministic random sequence (1,200 actions) and require each action to have succeeded.
contract HandlerCoverage is Test {
    function test_handlerReachesEveryPath() public {
        Handler h = new Handler();
        uint256 r = 0xC0FFEE;
        for (uint256 step = 0; step < 1200; step++) {
            r = uint256(keccak256(abi.encode(r)));
            uint256 a = r >> 8; uint256 b = r >> 40; uint256 c = r >> 72; uint256 d = r >> 104; uint256 e = r >> 136;
            bytes memory call;
            uint256 pick = r % 14;
            if (pick == 0) call = abi.encodeCall(h.deposit, (a, b));
            else if (pick == 1) call = abi.encodeCall(h.withdraw, (a, b));
            else if (pick == 2) call = abi.encodeCall(h.createLong, (a, b % 2 == 0, c, d, e, b));
            else if (pick == 3) call = abi.encodeCall(h.createShort, (a, b % 2 == 0, c, d, e, b));
            else if (pick == 4) call = abi.encodeCall(h.createShortTrove, (a, b % 2 == 0, c, d, e, b, c));
            else if (pick == 5) call = abi.encodeCall(h.fillLong, (a, b));
            else if (pick == 6) call = abi.encodeCall(h.fillShort, (a, b));
            else if (pick == 7) call = abi.encodeCall(h.settle, (b));
            else if (pick == 8) call = abi.encodeCall(h.refund, (a, b));
            else if (pick == 9) call = abi.encodeCall(h.cancel, (b));
            else if (pick == 10) call = abi.encodeCall(h.movePrice, (b));
            else if (pick == 11) call = abi.encodeCall(h.warp, (b % 6 hours));
            else if (pick == 12) call = abi.encodeCall(h.setIV, (b));
            else call = abi.encodeCall(h.buyAndExerciseNow, (a, b % 2 == 0, c, d));
            (bool ok,) = address(h).call(call);
            ok; // reverts are expected for some random inputs
        }
        string[10] memory k = ["deposit", "withdraw", "createLong", "createShort", "createShortTrove",
            "fillLong", "fillShort", "settle", "refund", "buyExercise"];
        for (uint256 i = 0; i < k.length; i++) {
            uint256 n = h.calls(bytes32(bytes(k[i])));
            emit log_named_uint(k[i], n);
            assertGt(n, 0, string.concat("path never succeeded: ", k[i]));
        }
        emit log_named_uint("cancel", h.calls(bytes32(bytes("cancel"))));
        emit log_named_uint("options created", h.pool().nextId() - 1);
    }
}

/// Stateless property tests for the on-chain Black-Scholes maths.
contract OptionPoolPricingFuzz is Test {
    OptionPool pool;

    function setUp() public {
        MockERC20v2 musd = new MockERC20v2("MUSD", "MUSD");
        yMUSD y = new yMUSD();
        pool = new OptionPool(address(musd), address(y), address(new MockOracle(100_000)), address(new MockTrove()), address(new MockBorrowerOps()));
        y.setPool(address(pool));
    }

    function _inputs(uint256 s, uint256 k, uint256 t) internal pure returns (uint256 spot, uint256 strike, uint256 secs) {
        spot = bound(s, 1_000, 1_000_000) * 1e18;
        strike = spot * bound(k, 50, 200) / 100;
        secs = bound(t, 15 minutes, 14 days);
    }

    /// No-arbitrage bounds: 0 <= call <= spot, 0 <= put <= strike.
    function testFuzz_priceBounds(uint256 s, uint256 k, uint256 t) public view {
        (uint256 spot, uint256 strike, uint256 secs) = _inputs(s, k, t);
        assertLe(pool.bsPrice(true, spot, strike, secs), spot);
        assertLe(pool.bsPrice(false, spot, strike, secs), strike);
    }

    /// Put-call parity: C - P = S - K·e^(-rT), within 0.01% of spot.
    function testFuzz_putCallParity(uint256 s, uint256 k, uint256 t) public view {
        (uint256 spot, uint256 strike, uint256 secs) = _inputs(s, k, t);
        int256 c = int256(pool.bsPrice(true, spot, strike, secs));
        int256 p = int256(pool.bsPrice(false, spot, strike, secs));
        // e^(-rT) with r = 5%: T <= 14 days so rT <= 0.0019; second-order series is exact to ~1e-9
        int256 rT = int256(5e16 * secs / 365 days);
        int256 disc = 1e18 - rT + rT * rT / 2e18;
        int256 rhs = int256(spot) - int256(strike) * disc / 1e18;
        assertApproxEqAbs(c - p, rhs, spot / 10_000, "put-call parity");
    }

    /// Calls never get cheaper as spot rises; puts never get cheaper as spot falls.
    function testFuzz_monotonicInSpot(uint256 s, uint256 k, uint256 t, uint256 bump) public view {
        (uint256 spot, uint256 strike, uint256 secs) = _inputs(s, k, t);
        uint256 spot2 = spot + spot * bound(bump, 1, 20) / 100;
        // tolerance: 1e-7 of spot for the A&S CDF approximation
        assertGe(pool.bsPrice(true, spot2, strike, secs) + spot / 1e7, pool.bsPrice(true, spot, strike, secs));
        assertGe(pool.bsPrice(false, spot, strike, secs) + spot / 1e7, pool.bsPrice(false, spot2, strike, secs));
    }

    /// Longer expiry is never cheaper (theta), for calls and puts.
    function testFuzz_monotonicInTime(uint256 s, uint256 k, uint256 t, uint256 extra) public view {
        (uint256 spot, uint256 strike, uint256 secs) = _inputs(s, k, t);
        uint256 secs2 = secs + bound(extra, 1 hours, 7 days);
        assertGe(pool.bsPrice(true, spot, strike, secs2) + spot / 1e7, pool.bsPrice(true, spot, strike, secs));
        // European puts can lose value with time when deep ITM (interest); allow the r·K·T effect
        assertGe(pool.bsPrice(false, spot, strike, secs2) + strike * 5e16 * (secs2 - secs) / 365 days / 1e18 + spot / 1e7,
                 pool.bsPrice(false, spot, strike, secs));
    }
}
