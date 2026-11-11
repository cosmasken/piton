// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PitonMath.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./yMUSD.sol";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ISkipOracle {
    function latestRoundData() external view returns (
        uint80, int256 answer, uint256, uint256 updatedAt, uint80
    );
    function decimals() external view returns (uint8);
}

interface ITroveManager {
    function getTroveStatus(address borrower) external view returns (uint256);
    function getTroveColl(address borrower)   external view returns (uint256);
    function getTroveDebt(address borrower)   external view returns (uint256);
}

interface IBorrowerOperationsSignatures {
    /// @dev Mezo's signed borrow. The digest commits to exact amount, borrower, recipient,
    ///      a per-borrower nonce and a deadline — NOT to msg.sender — so a signature must be
    ///      consumed in the same tx it is received (never stored).
    function withdrawMUSDWithSignature(
        uint256 _amount,
        address _upperHint,
        address _lowerHint,
        address _borrower,
        address _recipient,
        bytes   calldata _signature,
        uint256 _deadline
    ) external;
}


/// @title OptionPool — Piton V2 unified options engine + liquidity pool
contract OptionPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    // External dependencies, fixed at deploy (no setter can repoint them).
    address public immutable SKIP_ORACLE;
    address public immutable TROVE_MANAGER;
    address public immutable BORROWER_OPS_SIGS;

    /// @notice Oldest oracle price (seconds) accepted for anything that opens or prices risk: pool sales, orders,
    ///         sell-back, deposits, quotes. Mezo's Skip oracle updates every block (~4 s): 30 s is about 7 blocks.
    ///         A looser limit lets a trader act on a price the contract hasn't seen yet (stale-price arbitrage).
    uint256 public constant PRICE_STALENESS   = 30;
    /// @notice Oldest price accepted to exercise. Looser, so a short oracle hiccup near expiry does not stop a
    ///         holder from exercising a winning option (an option that expires unexercised loses its value).
    uint256 internal constant EXERCISE_PRICE_STALENESS = 120;
    uint256 public constant MIN_EXPIRY        = 15 minutes;
    uint256 public constant MAX_EXPIRY        = 14 days;
    uint256 public constant PRECISION         = 1e18;
    uint256 public constant MIN_ICR           = 15e17; // 150%

    // ─── Types ───────────────────────────────────────────────────────────────

    enum OptionType  { CALL, PUT }
    enum MarginType  { MUSD, TROVE }
    enum OrderStatus { OPEN, FILLED, SETTLED, REFUNDED, CLOSED }

    struct Option {
        uint256     id;
        OptionType  optionType;
        OrderStatus status;
        address     long;           // buyer (set at fill)
        address     short;          // seller (pool address or human)
        bool        filledByPool;
        MarginType  marginType;
        uint256     strike;         // 18 dec, MUSD per BTC
        uint256     premium;        // 18 dec MUSD
        uint256     quantity;       // 18 dec BTC
        uint256     expiry;         // unix timestamp
        uint256     collateral;     // MUSD locked (for TROVE margin: drawn from the Trove at creation)
    }

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20  public immutable musd;
    yMUSD   public immutable ymusd;

    uint256 public nextId = 1;
    mapping(uint256 => Option) public options;

    // Pool accounting
    uint256 public totalAssets;       // MUSD owned by pool (deposits + premiums - losses)
    uint256 public lockedCollateral;  // MUSD currently backing open pool shorts

    // Fee config
    uint256 public protocolFeeBps    = 200;   // 2%
    uint256 public performanceFeeBps = 1500;  // 15%
    address public feeRecipient;

    // Pool performance tracking (pool-wide)
    uint256 public totalPremiumsEarned;
    uint256 public totalSettlementsPaid;
    uint256 public totalPerformanceFeePaid;
    /// @notice Net yield already charged a performance fee (high-water mark). Fees apply only to
    ///         yield above this, so rate changes are never retroactive and losses must be recovered
    ///         before any further fee.
    uint256 public perfFeeHighWater;

    /// @notice Open pool-sold options, so LP shares can be priced net of what they would pay out now.
    ///         Bounded so the pricing loop always fits in a block.
    ///         Owner-adjustable up to a hard ceiling whose worst-case gas is checked in the test suite.
    uint256 public maxOpenPoolOptions = 50;
    uint256 public constant MAX_OPEN_POOL_OPTIONS_CEILING = 150; // ~4.3M gas to price the book; Mezo's block gas limit is 10M
    uint256[] internal openPoolOptions;
    mapping(uint256 => uint256) internal openPoolSlot; // option id => index + 1

    /// @dev Premium booked on a pool-sold option. It stays "unearned" (not LP profit) until the option
    ///      ends, and is released gradually as expiry approaches (see _positionLiability).
    struct PoolPos { uint128 netPremium; uint64 filledAt; }
    mapping(uint256 => PoolPos) internal poolPos;
    /// @notice Net premium of open pool options: booked, but not yet recognised as yield.
    uint256 public unrecognizedPremium;

    // Pricing
    uint256 public iv = 8e17;         // 80% default, 18 dec — mid implied vol (set by owner or ivKeeper)
    uint256 public ivSpreadBps = 1500; // pool sells at iv * (1 + spread): 15% safety margin for LPs
    address public ivKeeper;           // bot allowed to update iv (cannot touch anything else)
    /// @notice The keeper (not the owner) may change IV at most this often and by at most this share of
    ///         the current value per change. Bounds what a stolen keeper key can do.
    uint256 public ivMinInterval = 50 minutes;
    uint256 public maxIvStepBps  = 1500;
    uint256 public lastIvUpdate;
    uint256 public constant MIN_IV = 25e16;  // 25%
    uint256 public constant MAX_IV = 15e17;  // 150%
    uint256 public constant MAX_IV_SPREAD_BPS = 5000;

    event IVUpdated(uint256 iv, address indexed by);
    uint256 public constant R = 5e16; // 5% risk-free rate, 18 dec

    // Limits
    uint256 public tvlCap             = 50_000e18;
    uint256 public maxOptionCollateral = 10_000e18;

    bool public paused;

    // Exit protections (see suggestion #2)
    /// @notice Fee on withdrawals made while pool options are open. It stays in the pool for remaining LPs.
    uint256 public withdrawalFeeBps = 25;
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = 100;
    /// @notice After depositing, an LP can neither withdraw nor transfer yMUSD for this long.
    uint256 public depositLockSeconds = 1 hours;
    uint256 public constant MAX_DEPOSIT_LOCK = 7 days;
    mapping(address => uint256) public depositLockExpiry;

    // Pool-fill risk limits (suggestion #3)
    /// @notice Pool fills stop once locked collateral would exceed this share of pool assets, so some
    ///         liquidity always stays withdrawable.
    uint256 public maxUtilisationBps = 8000;
    /// @notice One option's collateral may use at most this share of pool assets: no single bet can
    ///         lock most of the pool.
    uint256 public maxOptionExposureBps = 2500;

    /// @notice Minimum price for locking collateral, as annual % of the collateral (bps). Stops the pool
    ///         selling nearly-free long-dated options that tie up LP capital for nothing.
    uint256 public minRentBps = 500;
    uint256 public constant MAX_MIN_RENT_BPS = 5000;

    /// @notice The pool only sells options with a strike within this distance of spot (bps). Far-away
    ///         strikes are where the model is least reliable and a wrong price costs the most.
    uint256 public maxStrikeDistanceBps = 3000;

    /// @notice The pool only sells options with at least this much time left. Very short options are the
    ///         ones most exposed to stale prices and last-minute oracle moves.
    uint256 public minPoolExpiry = 1 hours;

    /// @notice Extra IV spread (bps) charged at 100% utilisation; scales with utilisation squared.
    uint256 public utilSpreadBps = 2000;
    uint256 public constant MAX_UTIL_SPREAD_BPS = 10000;

    // Circuit breaker (suggestion #8): a fast price move pauses new risk (pool fills, deposits) for a
    // while. Exits, settlement, refunds and cancellations are never blocked.
    uint256 public cbWindow = 10 minutes;     // moves are measured against the price at the start of this window
    uint256 public cbMaxMoveBps = 500;        // 5% inside one window trips the breaker
    uint256 public cbCooldown = 30 minutes;   // how long new risk stays paused after a trip
    uint256 public cbRefPrice;
    uint256 public cbRefTime;
    uint256 public cbUntil;

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 musdIn, uint256 sharesOut);
    event Withdrawn(address indexed user, uint256 sharesIn, uint256 musdOut);
    event OrderCreated(uint256 indexed id, OptionType optionType, address indexed creator, bool isLong);
    event OrderFilled(uint256 indexed id, address indexed filler, bool byPool);
    event Settled(uint256 indexed id, address indexed long, uint256 profit);
    event Refunded(uint256 indexed id, address indexed short);
    event Cancelled(uint256 indexed id, address indexed by);

    // Admin changes, so off-chain monitoring can see every parameter change
    event IvKeeperSet(address indexed keeper);
    event IvSpreadSet(uint256 bps);
    event TvlCapSet(uint256 cap);
    event MaxOptionCollateralSet(uint256 max);
    event FeeRecipientSet(address indexed recipient);
    event ProtocolFeeSet(uint256 bps);
    event PerformanceFeeSet(uint256 bps);
    event PausedSet(bool paused);
    event WithdrawalFeeSet(uint256 bps);
    event DepositLockSet(uint256 seconds_);
    event IvLimitsSet(uint256 minInterval, uint256 stepBps);
    event MaxOpenPoolOptionsSet(uint256 n);
    event BreakerSet(uint256 window, uint256 maxMoveBps, uint256 cooldown);
    event BreakerTripped(uint256 price, uint256 refPrice, uint256 until);
    event UtilSpreadSet(uint256 bps);
    event MinPoolExpirySet(uint256 seconds_);
    event MaxStrikeDistanceSet(uint256 bps);
    event MinRentSet(uint256 bps);
    event RiskLimitsSet(uint256 maxUtilisationBps, uint256 maxOptionExposureBps);


    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _musd, address _ymusd, address _oracle, address _troveManager, address _borrowerOps) Ownable(msg.sender) {
        require(_musd != address(0) && _ymusd != address(0) && _oracle != address(0)
            && _troveManager != address(0) && _borrowerOps != address(0), "zero address");
        musd              = IERC20(_musd);
        ymusd             = yMUSD(_ymusd);
        feeRecipient      = msg.sender;
        SKIP_ORACLE       = _oracle;
        TROVE_MANAGER     = _troveManager;
        BORROWER_OPS_SIGS = _borrowerOps;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier notPaused() { require(!paused, "paused"); _; }

    // ─── Oracle ──────────────────────────────────────────────────────────────

    function _spot() internal view returns (uint256) { return _spotMaxAge(PRICE_STALENESS); }

    function _spotMaxAge(uint256 maxAge) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = ISkipOracle(SKIP_ORACLE).latestRoundData();
        require(answer > 0, "invalid price");
        require(block.timestamp - updatedAt <= maxAge, "stale price");
        uint8 dec = ISkipOracle(SKIP_ORACLE).decimals();
        return uint256(answer) * PRECISION / (10 ** uint256(dec));
    }

    /// @dev Black-Scholes premium at the mid IV, all inputs 1e18 scaled
    function bsPrice(
        bool    isCall,
        uint256 spot,
        uint256 strike,
        uint256 timeToExpirySeconds
    ) public view returns (uint256) {
        return _bs(isCall, spot, strike, timeToExpirySeconds, iv);
    }

    /// @notice IV the pool actually sells at (mid IV plus the LP safety margin).
    function askIv() public view returns (uint256) {
        return iv * (10000 + ivSpreadBps) / 10000;
    }

    function _bs(bool isCall, uint256 spot, uint256 strike, uint256 timeToExpirySeconds, uint256 vol)
        internal pure returns (uint256)
    {
        return PitonMath.bs(isCall, spot, strike, timeToExpirySeconds, vol);
    }


    // ─── Pool: Deposit / Withdraw ─────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant notPaused {
        require(amount > 0, "zero amount");
        require(totalAssets + amount <= tvlCap, "tvl cap");
        // A stale price makes NAV assume the worst case (shares look cheap): never let new money in at that price
        require(!_breaker(_spot()), "circuit breaker");

        uint256 shares;
        uint256 supply = ymusd.totalSupply();
        // Shares are priced on net asset value: assets minus what open pool options would pay if
        // exercised now. Otherwise a depositor could buy in above fair value while the pool is losing.
        uint256 nav = _netAssets();
        // After a total loss, outstanding yMUSD is worth nothing. Minting 1:1 here would hand those
        // holders a share of the new depositor's money, so block deposits until the old shares are
        // cleared (holders can withdraw 0, or the owner calls clearWorthlessShares).
        require(!(supply > 0 && nav == 0), "pool insolvent: clear old shares first");
        if (supply == 0) {
            shares = amount;
            require(amount >= 1e15, "min deposit 0.001 MUSD"); // inflation attack guard
        } else {
            shares = amount * supply / nav;
        }

        totalAssets += amount; // effects before interactions
        depositLockExpiry[msg.sender] = block.timestamp + depositLockSeconds;
        musd.safeTransferFrom(msg.sender, address(this), amount);
        ymusd.mint(msg.sender, shares);

        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0, "zero shares");
        uint256 supply = ymusd.totalSupply();
        require(supply > 0, "no supply");
        require(block.timestamp >= depositLockExpiry[msg.sender], "deposit locked");

        // Priced on net asset value so a leaving LP takes their share of open losses with them.
        uint256 musdOut = shares * _netAssets() / supply;
        // Leaving while options are open costs a small fee, which stays in the pool for the LPs who remain.
        if (openPoolOptions.length > 0) musdOut -= musdOut * withdrawalFeeBps / 10000;
        uint256 available = totalAssets - lockedCollateral;
        require(musdOut <= available, "insufficient liquidity");

        totalAssets -= musdOut; // effects before interactions
        ymusd.burn(msg.sender, shares);
        musd.safeTransfer(msg.sender, musdOut);

        emit Withdrawn(msg.sender, shares, musdOut);
    }

    event SharesCleared(uint256 holders, uint256 shares);

    /// @notice After a total loss (no assets left), burn yMUSD that is worth nothing so the pool can
    ///         take deposits again. Callable only when totalAssets == 0, so it can never touch value.
    ///         `holders` is built off-chain from yMUSD Transfer events; reverts unless it clears all supply.
    function clearWorthlessShares(address[] calldata holders) external onlyOwner {
        require(totalAssets == 0 && lockedCollateral == 0, "pool has assets");
        uint256 burned = 0;
        for (uint256 i = 0; i < holders.length; i++) {
            uint256 bal = ymusd.balanceOf(holders[i]);
            if (bal > 0) { ymusd.burn(holders[i], bal); burned += bal; }
        }
        require(ymusd.totalSupply() == 0, "holders list incomplete");
        emit SharesCleared(holders.length, burned);
    }

    // ─── Net asset value ──────────────────────────────────────────────────────

    /// @dev What one open pool option is worth as a liability of the pool: the larger of
    ///      (a) what it would pay if exercised now, and
    ///      (b) its unearned premium, which decays with the square root of the time left (an option's
    ///          time value shrinks roughly like sqrt(time), so premium is released slowly at first and
    ///          faster near expiry). Capped at the option's collateral. If the oracle is unavailable the
    ///          worst case (full collateral) is assumed, so exits keep working and are never priced too high.
    ///      Counting the premium as a liability stops anyone profiting by joining the pool just before a
    ///      sale/expiry or leaving right after one.
    function _positionLiability(uint256 id, bool oracleOk, uint256 spot) internal view returns (uint256) {
        Option storage o = options[id];
        if (o.expiry <= block.timestamp) return 0; // can no longer be exercised: premium is earned
        if (!oracleOk) return o.collateral;
        PoolPos storage p = poolPos[id];
        uint256 rem   = o.expiry - block.timestamp;
        uint256 total = o.expiry - p.filledAt;
        uint256 decayed = (rem >= total || total == 0)
            ? uint256(p.netPremium)
            : uint256(p.netPremium) * PitonMath.sqrt(rem * PRECISION / total) / PRECISION;
        uint256 intr = _intrinsic(o.optionType, o.strike, o.quantity, spot);
        uint256 l = intr > decayed ? intr : decayed;
        return l > o.collateral ? o.collateral : l;
    }

    function _poolLiability() internal view returns (uint256 liability) {
        uint256 n = openPoolOptions.length;
        if (n == 0) return 0;
        (bool ok, uint256 spot) = _trySpot();
        for (uint256 i = 0; i < n; i++) liability += _positionLiability(openPoolOptions[i], ok, spot);
    }

    function _netAssets() internal view returns (uint256) {
        uint256 l = _poolLiability();
        return totalAssets > l ? totalAssets - l : 0;
    }

    function _trySpot() internal view returns (bool, uint256) {
        try this.spotPrice() returns (uint256 s) { return (true, s); } catch { return (false, 0); }
    }

    /// @notice Pool assets minus the liability of open pool options (exercise value or unearned
    ///         premium, whichever is larger). LP shares are minted and redeemed at this value.
    function netAssetValue() external view returns (uint256) { return _netAssets(); }

    function openPoolOptionCount() external view returns (uint256) { return openPoolOptions.length; }

    function _addOpenPoolOption(uint256 id, uint256 netPremium) internal {
        openPoolOptions.push(id);
        openPoolSlot[id] = openPoolOptions.length;
        poolPos[id] = PoolPos({ netPremium: uint128(netPremium), filledAt: uint64(block.timestamp) });
        unrecognizedPremium += netPremium;
    }

    function _removeOpenPoolOption(uint256 id) internal {
        uint256 slot = openPoolSlot[id];
        if (slot == 0) return;
        uint256 last = openPoolOptions[openPoolOptions.length - 1];
        openPoolOptions[slot - 1] = last;
        openPoolSlot[last] = slot;
        openPoolOptions.pop();
        delete openPoolSlot[id];
        unrecognizedPremium -= poolPos[id].netPremium; // the premium is now recognised as yield
        delete poolPos[id];
    }

    // ─── Collateral helpers ───────────────────────────────────────────────────

    /// @notice Call payouts are capped: the short locks (CALL_CAP_MULTIPLE * spot - strike) * qty, so the
    ///         long's max profit is reached if BTC rises to CALL_CAP_MULTIPLE x today's spot.
    uint256 public constant CALL_CAP_MULTIPLE = 3;

    function _callCollateral(uint256 spot, uint256 strike, uint256 quantity)
        internal pure returns (uint256)
    {
        uint256 capPrice = spot * CALL_CAP_MULTIPLE;
        uint256 cap = capPrice > strike ? capPrice - strike : 0;
        return cap * quantity / PRECISION;
    }

    function _putCollateral(uint256 strike, uint256 quantity)
        internal pure returns (uint256)
    {
        return strike * quantity / PRECISION;
    }

    function _requiredCollateral(OptionType t, uint256 spot, uint256 strike, uint256 quantity)
        internal pure returns (uint256)
    {
        return t == OptionType.CALL
            ? _callCollateral(spot, strike, quantity)
            : _putCollateral(strike, quantity);
    }

    /// @dev Value of exercising right now: (spot - strike) for calls, (strike - spot) for puts.
    function _intrinsic(OptionType t, uint256 strike, uint256 quantity, uint256 spot)
        internal pure returns (uint256)
    {
        if (t == OptionType.CALL) return spot > strike ? (spot - strike) * quantity / PRECISION : 0;
        return strike > spot ? (strike - spot) * quantity / PRECISION : 0;
    }

    /// @dev Smallest gross premium whose net (after the protocol fee) covers immediate exercise, so
    ///      buying from the pool and exercising at once can never take value from LPs.
    function _intrinsicFloor(OptionType t, uint256 strike, uint256 quantity, uint256 spot)
        internal view returns (uint256)
    {
        uint256 intr = _intrinsic(t, strike, quantity, spot);
        if (intr == 0) return 0;
        uint256 keep = 10000 - protocolFeeBps;
        return (intr * 10000 + keep - 1) / keep; // round up
    }

    // ─── Fee helpers ──────────────────────────────────────────────────────────

    function _takePremiumFee(uint256 premium) internal returns (uint256 net) {
        uint256 fee = premium * protocolFeeBps / 10000;
        if (fee > 0) musd.safeTransfer(feeRecipient, fee);
        return premium - fee;
    }

    function _takePerformanceFee() internal {
        // Only premium from options that have ended counts as yield, so the fee is never charged on
        // premium that a still-open option may yet pay back out.
        uint256 recognised = totalPremiumsEarned - unrecognizedPremium;
        if (recognised <= totalSettlementsPaid) return;
        uint256 netYield = recognised - totalSettlementsPaid;
        if (netYield <= perfFeeHighWater) return; // below the high-water mark: losses not yet recovered
        uint256 newYield = netYield - perfFeeHighWater;
        if (performanceFeeBps == 0) { perfFeeHighWater = netYield; return; } // fee-free yield stays fee-free
        uint256 fee = newYield * performanceFeeBps / 10000;
        // never dip into collateral locked for open options; the uncharged part stays above the
        // high-water mark and is collected later at the rate in force when it was earned
        uint256 free = totalAssets > lockedCollateral ? totalAssets - lockedCollateral : 0;
        uint256 charged = newYield;
        if (fee > free) { fee = free; charged = fee * 10000 / performanceFeeBps; }
        perfFeeHighWater += charged;
        if (fee > 0) {
            totalAssets -= fee;
            totalPerformanceFeePaid += fee;
            musd.safeTransfer(feeRecipient, fee);
        }
    }


    // ─── Create Long Order (buyer) ────────────────────────────────────────────

    /// @notice Place a long order. Pool fills automatically if capital available.
    function createLongOrder(
        OptionType optionType,
        uint256    strike,
        uint256    quantity,
        uint256    expiry,
        uint256    premium
    ) external nonReentrant notPaused returns (uint256 id) {
        require(strike > 0 && quantity > 0 && premium > 0, "invalid params");
        require(expiry > block.timestamp + MIN_EXPIRY, "expiry too soon");
        require(expiry <= block.timestamp + MAX_EXPIRY, "expiry too far");

        musd.safeTransferFrom(msg.sender, address(this), premium);

        id = nextId++;
        Option storage o = options[id];
        o.id         = id;
        o.optionType = optionType;
        o.status     = OrderStatus.OPEN;
        o.long       = msg.sender;
        o.strike     = strike;
        o.premium    = premium;
        o.quantity   = quantity;
        o.expiry     = expiry;

        emit OrderCreated(id, optionType, msg.sender, true);

        // Attempt automatic pool fill
        _tryPoolFill(id);
    }

    function _tryPoolFill(uint256 id) internal {
        Option storage o = options[id];
        uint256 spot = _spot();
        if (_breaker(spot)) return; // fast market: the order rests as an open bid instead
        if (o.expiry - block.timestamp < minPoolExpiry) return; // too short for the pool to sell

        uint256 dist = o.strike > spot ? o.strike - spot : spot - o.strike;
        if (dist * 10000 > spot * maxStrikeDistanceBps) return; // strike too far from spot for the pool

        // Validate premium against the pool's own price (5% tolerance on the model price)
        (uint256 fair, uint256 hardFloor) = _poolPrice(o.optionType, spot, o.strike, o.quantity, o.expiry);
        if (o.premium < fair * 95 / 100) return; // below fair value, skip
        // Never sell below the hard floors (immediate-exercise value after the fee, minimum rent):
        // otherwise buying and exercising at once, or very cheap long-dated options, would cost LPs.
        if (o.premium < hardFloor) return;
        if (openPoolOptions.length >= maxOpenPoolOptions) return;

        uint256 collateral = _requiredCollateral(o.optionType, spot, o.strike, o.quantity);
        if (collateral == 0 || collateral > maxOptionCollateral) return;

        // Check pool has enough free capital
        if (totalAssets < lockedCollateral + collateral) return;
        if (totalAssets >= tvlCap) return;
        if ((lockedCollateral + collateral) * 10000 > totalAssets * maxUtilisationBps) return;
        if (collateral * 10000 > totalAssets * maxOptionExposureBps) return;

        if (o.premium > type(uint128).max) return;

        // Fill: credit premium to pool, lock collateral
        uint256 netPremium = _takePremiumFee(o.premium);
        totalAssets       += netPremium;
        totalPremiumsEarned += netPremium;
        lockedCollateral  += collateral;

        o.short        = address(this);
        o.filledByPool = true;
        o.collateral   = collateral;
        o.status       = OrderStatus.FILLED;
        _addOpenPoolOption(id, netPremium);

        emit OrderFilled(id, address(this), true);
    }

    // ─── Create Short Order (manual seller) ──────────────────────────────────

    /// @notice Place a short order with MUSD collateral.
    function createShortOrder(
        OptionType optionType,
        uint256    strike,
        uint256    quantity,
        uint256    expiry,
        uint256    premium
    ) external nonReentrant notPaused returns (uint256 id) {
        require(strike > 0 && quantity > 0 && premium > 0, "invalid params");
        require(expiry > block.timestamp + MIN_EXPIRY, "expiry too soon");
        require(expiry <= block.timestamp + MAX_EXPIRY, "expiry too far");

        uint256 spot       = _spot();
        uint256 collateral = _requiredCollateral(optionType, spot, strike, quantity);
        require(collateral > 0, "zero collateral: strike too far OTM");
        require(collateral <= maxOptionCollateral, "collateral exceeds max");

        musd.safeTransferFrom(msg.sender, address(this), collateral);

        id = nextId++;
        Option storage o = options[id];
        o.id         = id;
        o.optionType = optionType;
        o.status     = OrderStatus.OPEN;
        o.short      = msg.sender;
        o.strike     = strike;
        o.premium    = premium;
        o.quantity   = quantity;
        o.expiry     = expiry;
        o.collateral = collateral;
        o.marginType = MarginType.MUSD;

        emit OrderCreated(id, optionType, msg.sender, false);
    }

    /// @notice Place a short order funded by Mezo Trove debt.
    ///         The short signs (off-chain) a Mezo `WithdrawMUSD` for exactly `marginAmount` with
    ///         recipient = THEMSELVES, and approves this pool for `marginAmount` MUSD. Here we submit
    ///         the signature (borrowing against their Trove into their own wallet) and immediately
    ///         pull the margin. Nothing is stored. If someone front-runs the signature from the
    ///         mempool, the MUSD still lands in the short's own wallet — no funds can be stranded.
    ///         The short's BTC stays in their Trove.
    /// @param marginAmount MUSD to draw; must be >= required collateral (signed amount must match).
    function createShortOrderTrove(
        OptionType optionType,
        uint256    strike,
        uint256    quantity,
        uint256    expiry,
        uint256    premium,
        uint256    marginAmount,
        bytes calldata troveSig,
        uint256    troveDeadline
    ) external nonReentrant notPaused returns (uint256 id) {
        require(strike > 0 && quantity > 0 && premium > 0, "invalid params");
        require(expiry > block.timestamp + MIN_EXPIRY, "expiry too soon");
        require(expiry <= block.timestamp + MAX_EXPIRY, "expiry too far");
        require(troveSig.length > 0 && troveDeadline > block.timestamp, "invalid trove sig");

        uint256 spot     = _spot();
        uint256 required = _requiredCollateral(optionType, spot, strike, quantity);
        require(required > 0, "zero collateral: strike too far OTM");
        require(marginAmount >= required, "margin below required");
        require(marginAmount <= maxOptionCollateral, "collateral exceeds max");

        // Trove must stay healthy AFTER the draw (stricter than Mezo's own minimum ratio).
        ITroveManager tm = ITroveManager(TROVE_MANAGER);
        require(tm.getTroveStatus(msg.sender) == 1, "no active trove");
        // coll[1e18 BTC] * spot[1e18 USD/BTC] vs debt[1e18] * MIN_ICR[1e18]: both sides 1e36-scaled,
        // so no intermediate division / rounding.
        uint256 newDebt = tm.getTroveDebt(msg.sender) + marginAmount;
        require(tm.getTroveColl(msg.sender) * spot >= newDebt * MIN_ICR, "trove ICR too low after draw");

        // Effects first (the external calls below are to Mezo and MUSD; the whole function is also
        // nonReentrant). A revert in either call unwinds these writes.
        id = nextId++;
        Option storage o = options[id];
        o.id         = id;
        o.optionType = optionType;
        o.status     = OrderStatus.OPEN;
        o.short      = msg.sender;
        o.strike     = strike;
        o.premium    = premium;
        o.quantity   = quantity;
        o.expiry     = expiry;
        o.collateral = marginAmount;
        o.marginType = MarginType.TROVE;

        // Borrow into the short's own wallet, verify the amount, then pull it as margin.
        uint256 balBefore = musd.balanceOf(msg.sender);
        IBorrowerOperationsSignatures(BORROWER_OPS_SIGS).withdrawMUSDWithSignature(
            marginAmount, address(0), address(0), msg.sender, msg.sender, troveSig, troveDeadline
        );
        require(musd.balanceOf(msg.sender) - balBefore >= marginAmount, "trove draw short");
        musd.safeTransferFrom(msg.sender, address(this), marginAmount);

        emit OrderCreated(id, optionType, msg.sender, false);
    }

    // ─── Fill Short Order (buyer fills a manual short) ────────────────────────

    function fillLong(uint256 id) external nonReentrant notPaused {
        Option storage o = options[id];
        require(o.status == OrderStatus.OPEN, "not open");
        require(o.short != address(0) && o.long == address(0), "not a short order");
        require(o.expiry > block.timestamp, "expired");
        require(msg.sender != o.short, "cannot self-fill");

        musd.safeTransferFrom(msg.sender, address(this), o.premium);
        uint256 netPremium = _takePremiumFee(o.premium);
        musd.safeTransfer(o.short, netPremium);

        o.long   = msg.sender;
        o.status = OrderStatus.FILLED;

        emit OrderFilled(id, msg.sender, false);
    }


    // ─── Fill Long Order (manual seller takes the other side) ─────────────────

    /// @notice Take the short side of an open long order that the pool did not fill.
    ///         Seller posts MUSD collateral and receives the premium (less protocol fee).
    function fillShort(uint256 id) external nonReentrant notPaused {
        Option storage o = options[id];
        require(o.status == OrderStatus.OPEN, "not open");
        require(o.long != address(0) && o.short == address(0), "not a long order");
        require(o.expiry > block.timestamp, "expired");
        require(msg.sender != o.long, "cannot self-fill");

        uint256 collateral = _requiredCollateral(o.optionType, _spot(), o.strike, o.quantity);
        require(collateral > 0, "zero collateral: strike too far OTM");
        require(collateral <= maxOptionCollateral, "collateral exceeds max");

        musd.safeTransferFrom(msg.sender, address(this), collateral);
        uint256 netPremium = _takePremiumFee(o.premium);
        musd.safeTransfer(msg.sender, netPremium);

        o.short      = msg.sender;
        o.collateral = collateral;
        o.marginType = MarginType.MUSD;
        o.status     = OrderStatus.FILLED;

        emit OrderFilled(id, msg.sender, false);
    }

    // ─── Settlement ───────────────────────────────────────────────────────────

    function settle(uint256 id) external nonReentrant {
        require(msg.sender == options[id].long, "only long can settle");
        _settle(id, address(0));
    }

    // ─── Auto-exercise ────────────────────────────────────────────────────────

    /// @notice In-the-money options that their owner opted in are exercised by anyone in the last
    ///         `AUTO_EXERCISE_WINDOW` before expiry; the caller earns `keeperFeeBps` of the payout.
    uint256 public constant AUTO_EXERCISE_WINDOW = 5 minutes;
    uint256 public keeperFeeBps = 50;
    uint256 public constant MAX_KEEPER_FEE_BPS = 200;
    mapping(uint256 => bool) public autoExercise;
    event AutoExerciseSet(uint256 indexed id, bool on);
    event KeeperFeeSet(uint256 bps);

    function setAutoExercise(uint256 id, bool on) external {
        Option storage o = options[id];
        require(msg.sender == o.long && o.status == OrderStatus.FILLED, "not your open option");
        autoExercise[id] = on;
        emit AutoExerciseSet(id, on);
    }

    function settleFor(uint256 id) external nonReentrant {
        Option storage o = options[id];
        require(autoExercise[id], "auto-exercise not enabled");
        require(o.expiry > block.timestamp && o.expiry - block.timestamp <= AUTO_EXERCISE_WINDOW, "not in exercise window");
        _settle(id, msg.sender);
    }

    function setKeeperFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_KEEPER_FEE_BPS, "max 2%");
        keeperFeeBps = _bps;
        emit KeeperFeeSet(_bps);
    }

    function _settle(uint256 id, address keeper) internal {
        Option storage o = options[id];
        require(o.status == OrderStatus.FILLED, "not filled");
        require(o.expiry > block.timestamp, "expired");

        uint256 spot   = _spotMaxAge(EXERCISE_PRICE_STALENESS);
        uint256 profit = _profit(o, spot);
        require(profit > 0, "not in the money");

        o.status = OrderStatus.SETTLED;
        uint256 paid = profit > o.collateral ? o.collateral : profit;
        uint256 tip  = keeper == address(0) ? 0 : paid * keeperFeeBps / 10000; // comes out of the long's payout

        if (o.filledByPool) {
            _removeOpenPoolOption(id);
            lockedCollateral -= o.collateral;
            totalAssets      -= paid;
            totalSettlementsPaid += paid;
            _takePerformanceFee();
            // remaining collateral stays in pool
        } else {
            // Manual short (MUSD or Trove-funded margin: both are MUSD held by the pool)
            uint256 remaining = o.collateral - paid;
            if (remaining > 0) musd.safeTransfer(o.short, remaining);
        }
        musd.safeTransfer(o.long, paid - tip);
        if (tip > 0) musd.safeTransfer(keeper, tip);

        emit Settled(id, o.long, paid);
    }

    // ─── Sell back to the pool (close a long position early) ──────────────────

    /// @notice The pool buys back options it sold, at the mid-IV Black-Scholes value less a fixed 10% spread on
    ///         the volatility. It sells at mid x (1 + 15% + utilisation markup), so every
    ///         round trip leaves the pool a margin, and it never pays above mid value.
    uint256 public constant BID_SPREAD_BPS = 1000;
    event SoldBack(uint256 indexed id, address indexed long, uint256 payout);

    /// @notice What the pool would pay now to take back option `id` (0 if it cannot be sold back).
    function quoteBuyback(uint256 id) public view returns (uint256) {
        Option storage o = options[id];
        if (o.status != OrderStatus.FILLED || !o.filledByPool || o.expiry <= block.timestamp) return 0;
        (bool ok, uint256 spot) = _trySpot();
        if (!ok) return 0;
        uint256 vol = iv * (10000 - BID_SPREAD_BPS) / 10000;
        uint256 value = _bs(o.optionType == OptionType.CALL, spot, o.strike, o.expiry - block.timestamp, vol) * o.quantity / PRECISION;
        return value > o.collateral ? o.collateral : value;
    }

    /// @notice Sell option `id` back to the pool for at least `minPayout`. Only the pool's own sales can be
    ///         sold back; the premium the pool already booked stays with LPs, minus this payout.
    function sellBack(uint256 id, uint256 minPayout) external nonReentrant notPaused {
        Option storage o = options[id];
        require(msg.sender == o.long, "only long can sell back");
        require(!_breaker(_spot()), "circuit breaker");
        uint256 payout = quoteBuyback(id);
        require(payout > 0 && payout >= minPayout, "no bid");

        o.status = OrderStatus.CLOSED;
        _removeOpenPoolOption(id);
        lockedCollateral -= o.collateral;
        totalAssets      -= payout;
        totalSettlementsPaid += payout;
        _takePerformanceFee();
        musd.safeTransfer(msg.sender, payout);
        emit SoldBack(id, msg.sender, payout);
    }

    function _profit(Option storage o, uint256 spot) internal view returns (uint256) {
        return _intrinsic(o.optionType, o.strike, o.quantity, spot);
    }

    // ─── Refund (expiry) ──────────────────────────────────────────────────────

    function refund(uint256 id) external nonReentrant {
        Option storage o = options[id];
        require(o.status == OrderStatus.FILLED, "not filled");
        require(block.timestamp >= o.expiry, "not expired");

        o.status = OrderStatus.REFUNDED;

        if (o.filledByPool) {
            _removeOpenPoolOption(id);
            lockedCollateral -= o.collateral;
            // collateral stays in pool as yield
            _takePerformanceFee();
        } else {
            musd.safeTransfer(o.short, o.collateral);
        }

        emit Refunded(id, o.short);
    }

    // ─── Cancel open order ────────────────────────────────────────────────────

    function cancelOrder(uint256 id) external nonReentrant {
        Option storage o = options[id];
        require(o.status == OrderStatus.OPEN, "not open");

        if (o.long == msg.sender && o.short == address(0)) {
            // long order, unfilled — return premium
            o.status = OrderStatus.REFUNDED;
            musd.safeTransfer(o.long, o.premium);
        } else if (o.short == msg.sender && o.long == address(0)) {
            // short order, unfilled — return collateral
            o.status = OrderStatus.REFUNDED;
            musd.safeTransfer(o.short, o.collateral);
        } else {
            revert("not your order");
        }
        emit Cancelled(id, msg.sender);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function availableLiquidity() public view returns (uint256) {
        return totalAssets > lockedCollateral ? totalAssets - lockedCollateral : 0;
    }

    function utilisation() public view returns (uint256) {
        if (totalAssets == 0) return 0;
        return lockedCollateral * PRECISION / totalAssets;
    }

    function getOption(uint256 id) external view returns (Option memory) {
        return options[id];
    }


    function spotPrice() external view returns (uint256) {
        return _spot();
    }

    function quotePremium(
        bool isCall, uint256 strike, uint256 quantity, uint256 expiry
    ) external view returns (uint256) {
        require(expiry > block.timestamp, "expired");
        (uint256 fair, uint256 hardFloor) = _poolPrice(
            isCall ? OptionType.CALL : OptionType.PUT, _spot(), strike, quantity, expiry);
        return fair > hardFloor ? fair : hardFloor;
    }

    /// @dev The pool's sell price. `fair` is the model price at the ask IV; `hardFloor` is the least the
    ///      pool will ever accept: immediate-exercise value (after the fee) and a minimum rent on the
    ///      collateral it has to lock.
    function _poolPrice(OptionType t, uint256 spot, uint256 strike, uint256 quantity, uint256 expiry)
        internal view returns (uint256 fair, uint256 hardFloor)
    {
        uint256 collateral = _requiredCollateral(t, spot, strike, quantity);
        // Busier pool and bigger trade -> higher price: the markup grows with the square of the
        // utilisation this trade would leave behind (0 when idle, utilSpreadBps at 100%).
        uint256 u = totalAssets == 0 ? 10000 : (lockedCollateral + collateral) * 10000 / totalAssets;
        if (u > 10000) u = 10000;
        uint256 vol = iv * (10000 + ivSpreadBps + utilSpreadBps * u * u / 1e8) / 10000;
        fair = _bs(t == OptionType.CALL, spot, strike, expiry - block.timestamp, vol) * quantity / PRECISION;
        hardFloor = _intrinsicFloor(t, strike, quantity, spot);
        uint256 rent = collateral * minRentBps * (expiry - block.timestamp)
            / (10000 * 365 days);
        if (rent > hardFloor) hardFloor = rent;
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function setIV(uint256 _iv) external {
        bool isOwner = msg.sender == owner();
        require(isOwner || msg.sender == ivKeeper, "not owner or keeper");
        require(_iv >= MIN_IV && _iv <= MAX_IV, "iv out of range");
        if (!isOwner) {
            // A stolen keeper key can only walk the price slowly, giving the owner/guardian time to react
            require(block.timestamp >= lastIvUpdate + ivMinInterval, "iv updated too recently");
            uint256 d = _iv > iv ? _iv - iv : iv - _iv;
            require(d * 10000 <= iv * maxIvStepBps, "iv step too large");
        }
        lastIvUpdate = block.timestamp;
        iv = _iv;
        emit IVUpdated(_iv, msg.sender);
    }

    function setIvLimits(uint256 minInterval, uint256 stepBps) external onlyOwner {
        require(minInterval <= 1 days, "interval too long");
        require(stepBps >= 100 && stepBps <= 5000, "step out of range");
        ivMinInterval = minInterval;
        maxIvStepBps = stepBps;
        emit IvLimitsSet(minInterval, stepBps);
    }

    /// @dev address(0) is allowed on purpose: it disables the keeper (owner can still set IV).
    function setIvKeeper(address _keeper) external onlyOwner { ivKeeper = _keeper; emit IvKeeperSet(_keeper); }

    function setIvSpreadBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_IV_SPREAD_BPS, "spread too high");
        ivSpreadBps = _bps;
        emit IvSpreadSet(_bps);
    }

    function setTVLCap(uint256 _cap) external onlyOwner { tvlCap = _cap; emit TvlCapSet(_cap); }

    function setMaxOptionCollateral(uint256 _max) external onlyOwner { maxOptionCollateral = _max; emit MaxOptionCollateralSet(_max); }

    function setFeeRecipient(address _r) external onlyOwner {
        require(_r != address(0), "zero address");
        feeRecipient = _r;
        emit FeeRecipientSet(_r);
    }

    function setProtocolFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "max 5%");
        protocolFeeBps = _bps;
        emit ProtocolFeeSet(_bps);
    }

    function setPerformanceFeeBps(uint256 _bps) external nonReentrant onlyOwner {
        require(_bps <= 3000, "max 30%");
        _takePerformanceFee(); // yield earned so far is charged at the old rate, never the new one
        performanceFeeBps = _bps;
        emit PerformanceFeeSet(_bps);
    }

    function setWithdrawalFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_WITHDRAWAL_FEE_BPS, "max 1%");
        withdrawalFeeBps = _bps;
        emit WithdrawalFeeSet(_bps);
    }

    function setRiskLimits(uint256 _maxUtilBps, uint256 _maxExposureBps) external onlyOwner {
        require(_maxUtilBps > 0 && _maxUtilBps <= 10000 && _maxExposureBps > 0 && _maxExposureBps <= _maxUtilBps, "bad limits");
        maxUtilisationBps = _maxUtilBps;
        maxOptionExposureBps = _maxExposureBps;
        emit RiskLimitsSet(_maxUtilBps, _maxExposureBps);
    }

    function setMinRentBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_MIN_RENT_BPS, "max 50%");
        minRentBps = _bps;
        emit MinRentSet(_bps);
    }

    function setMaxStrikeDistanceBps(uint256 _bps) external onlyOwner {
        require(_bps >= 1000 && _bps <= 10000, "between 10% and 100%");
        maxStrikeDistanceBps = _bps;
        emit MaxStrikeDistanceSet(_bps);
    }

    function setMinPoolExpiry(uint256 _seconds) external onlyOwner {
        require(_seconds >= MIN_EXPIRY && _seconds <= 7 days, "out of range");
        minPoolExpiry = _seconds;
        emit MinPoolExpirySet(_seconds);
    }

    function setUtilSpreadBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_UTIL_SPREAD_BPS, "spread too high");
        utilSpreadBps = _bps;
        emit UtilSpreadSet(_bps);
    }

    function setBreaker(uint256 window, uint256 maxMoveBps, uint256 cooldown) external onlyOwner {
        require(window >= 1 minutes && window <= 1 days, "bad window");
        require(maxMoveBps >= 100 && maxMoveBps <= 50000, "bad move");
        require(cooldown <= 1 days, "bad cooldown");
        cbWindow = window; cbMaxMoveBps = maxMoveBps; cbCooldown = cooldown;
        emit BreakerSet(window, maxMoveBps, cooldown);
    }

    /// @dev Records the price and reports whether new risk is currently paused. Writes state, so the
    ///      trip sticks on every path that does not revert.
    function _breaker(uint256 spot) internal returns (bool) {
        if (block.timestamp < cbUntil) return true;
        if (cbRefTime == 0 || block.timestamp - cbRefTime > cbWindow) {
            cbRefPrice = spot; cbRefTime = block.timestamp; // start a fresh window
            return false;
        }
        uint256 d = spot > cbRefPrice ? spot - cbRefPrice : cbRefPrice - spot;
        if (d * 10000 <= cbRefPrice * cbMaxMoveBps) return false;
        cbUntil = block.timestamp + cbCooldown;
        emit BreakerTripped(spot, cbRefPrice, cbUntil);
        cbRefPrice = spot; cbRefTime = block.timestamp; // the new level becomes the reference
        return true;
    }

    /// @notice Anyone can feed the breaker a fresh price, so a crash is noticed even with no trading.
    function pokeCircuitBreaker() external returns (bool) { return _breaker(_spot()); }

    function setMaxOpenPoolOptions(uint256 n) external onlyOwner {
        require(n >= 1 && n <= MAX_OPEN_POOL_OPTIONS_CEILING, "out of range");
        maxOpenPoolOptions = n; // lowering never closes existing options; it only stops new pool fills
        emit MaxOpenPoolOptionsSet(n);
    }

    function setDepositLock(uint256 _seconds) external onlyOwner {
        require(_seconds <= MAX_DEPOSIT_LOCK, "max 7 days");
        depositLockSeconds = _seconds; // applies to deposits made after this call
        emit DepositLockSet(_seconds);
    }

    /// @notice Pause blocks new deposits, orders and fills. Withdraw, settle, refund and cancel stay
    ///         open, so users can always exit.
    /// @notice Pausing is the one action a low-privilege "guardian" key may take (e.g. a hot monitoring
    ///         bot or multisig signer). It cannot unpause, change parameters or touch funds.
    address public guardian;
    event GuardianSet(address indexed guardian);

    function setGuardian(address g) external onlyOwner { guardian = g; emit GuardianSet(g); }

    function pausePool() external {
        require(msg.sender == owner() || msg.sender == guardian, "not owner or guardian");
        paused = true; emit PausedSet(true);
    }
    function unpausePool() external onlyOwner { paused = false; emit PausedSet(false); }

    /// @dev Renouncing would freeze every parameter forever, including the ability to pause.
    function renounceOwnership() public view override onlyOwner { revert("renounce disabled"); }
}
