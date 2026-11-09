// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
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
    function adjustTroveWithSignature(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool    _isDebtIncrease,
        address _upperHint,
        address _lowerHint,
        address _borrower,
        address _recipient,
        bytes   calldata _signature,
        uint256 _deadline
    ) external;
}


/// @title OptionPool — Piton V2 unified options engine + liquidity pool
contract OptionPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    address public SKIP_ORACLE;
    address public TROVE_MANAGER;
    address public BORROWER_OPS_SIGS;

    uint256 public constant PRICE_STALENESS   = 7200;
    uint256 public constant MIN_EXPIRY        = 15 minutes;
    uint256 public constant MAX_EXPIRY        = 14 days;
    uint256 public constant PRECISION         = 1e18;
    uint256 public constant MIN_ICR           = 15e17; // 150%

    // ─── Types ───────────────────────────────────────────────────────────────

    enum OptionType  { CALL, PUT }
    enum MarginType  { MUSD, TROVE }
    enum OrderStatus { OPEN, FILLED, SETTLED, REFUNDED }

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
        uint256     collateral;     // MUSD locked
        bytes       troveSig;       // EIP-712 sig (TROVE margin only)
        uint256     troveDeadline;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20  public immutable musd;
    yMUSD   public immutable ymusd;

    uint256 public nextId = 1;
    mapping(uint256 => Option) public options;
    mapping(address => uint256[]) public userOptions;

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

    // Pricing
    uint256 public iv = 8e17;         // 80% default, 18 dec
    uint256 public constant R = 5e16; // 5% risk-free rate, 18 dec

    // Limits
    uint256 public tvlCap             = 50_000e18;
    uint256 public maxOptionCollateral = 10_000e18;

    bool public paused;

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 musdIn, uint256 sharesOut);
    event Withdrawn(address indexed user, uint256 sharesIn, uint256 musdOut);
    event OrderCreated(uint256 indexed id, OptionType optionType, address indexed creator, bool isLong);
    event OrderFilled(uint256 indexed id, address indexed filler, bool byPool);
    event Settled(uint256 indexed id, address indexed long, uint256 profit);
    event Refunded(uint256 indexed id, address indexed short);


    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _musd, address _ymusd, address _oracle, address _troveManager, address _borrowerOps) Ownable(msg.sender) {
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

    function _spot() internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = ISkipOracle(SKIP_ORACLE).latestRoundData();
        require(answer > 0, "invalid price");
        require(block.timestamp - updatedAt <= PRICE_STALENESS, "stale price");
        uint8 dec = ISkipOracle(SKIP_ORACLE).decimals();
        return uint256(answer) * PRECISION / (10 ** uint256(dec));
    }

    // ─── Black-Scholes (Abramowitz & Stegun) ─────────────────────────────────

    /// @dev Fixed-point natural log via 2^127 scaling. Accurate to ~1e-7.
    function _ln(uint256 x) internal pure returns (int256) {
        require(x > 0, "ln(0)");
        // scale x to [0.5, 1) range, count shifts
        int256 k = 0;
        uint256 y = x;
        while (y >= 2e18) { y /= 2; k++; }
        while (y < 1e18)  { y *= 2; k--; }
        // Padé approximation for ln(y) where y in [1,2), y scaled 1e18
        // ln(y) ≈ (y-1)/(y+1) * 2 * (1 + 1/3*z^2 + 1/5*z^4) where z=(y-1)/(y+1)
        int256 yi  = int256(y);
        int256 num = yi - 1e18;
        int256 den = yi + 1e18;
        int256 z   = num * 1e18 / den;
        int256 z2  = z * z / 1e18;
        int256 lny = 2 * z * (1e18 + z2 / 3 + z2 * z2 / (5 * 1e18)) / 1e18;
        int256 ln2 = 693147180559945309; // ln(2) * 1e18
        return lny + k * ln2;
    }

    /// @dev sqrt via Babylonian method, input/output 1e18 scaled
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1e18) / 2;
        uint256 y = x;
        while (z < y) { y = z; z = (x * 1e18 / z + z) / 2; }
        return y;
    }

    /// @dev Standard normal CDF via A&S 26.2.17, input 1e18 scaled
    function _cdf(int256 x) internal pure returns (uint256) {
        bool neg = x < 0;
        uint256 ax = neg ? uint256(-x) : uint256(x);
        // clamp — beyond ±8 the result is effectively 0 or 1
        if (ax > 8e18) return neg ? 0 : PRECISION;

        uint256 k1 = PRECISION * 1e18 / (PRECISION + 2316419 * ax / 1e7);
        uint256 pdf = _expNeg(ax * ax / (2 * 1e18)) * PRECISION / 2506628274631000502; // /sqrt(2π)*1e18

        uint256 k2 = k1 * k1 / PRECISION;
        uint256 k3 = k2 * k1 / PRECISION;
        uint256 k4 = k3 * k1 / PRECISION;
        uint256 k5 = k4 * k1 / PRECISION;

        uint256 poly = (3193815300 * k1 / 1e10)
                     + (18446956180 * k2 / 1e10)  // note: A&S coeff is negative, handled below
                     + (17814779370 * k3 / 1e10)
                     + (18212559780 * k4 / 1e10)  // negative
                     + (13302744290 * k5 / 1e10);

        // A&S signs: +a1 -a2 +a3 -a4 +a5
        uint256 a1 = 3193815300 * k1 / 1e10;
        uint256 a2 = 3565637820 * k2 / 1e10;
        uint256 a3 = 17814779370 * k3 / 1e10;
        uint256 a4 = 18212559780 * k4 / 1e10;
        uint256 a5 = 13302744290 * k5 / 1e10;
        poly = a1 + a3 + a5;
        uint256 neg_poly = a2 + a4;
        uint256 t = poly > neg_poly ? (poly - neg_poly) : 0;

        uint256 result = PRECISION - pdf * t / PRECISION;
        return neg ? PRECISION - result : result;
    }

    /// @dev e^(-x) for x >= 0, 1e18 scaled, via exp(-x) = 1/exp(x)
    function _expNeg(uint256 x) internal pure returns (uint256) {
        // Use series: e^x = sum x^n/n! up to n=20 for x < 20
        if (x >= 20e18) return 0;
        uint256 result = PRECISION;
        uint256 term   = PRECISION;
        for (uint256 i = 1; i <= 20; i++) {
            term = term * x / (i * PRECISION);
            result += term;
        }
        return PRECISION * PRECISION / result;
    }

    /// @dev Black-Scholes premium, all inputs 1e18 scaled
    function bsPrice(
        bool    isCall,
        uint256 spot,
        uint256 strike,
        uint256 timeToExpirySeconds
    ) public view returns (uint256) {
        if (timeToExpirySeconds == 0 || spot == 0 || strike == 0) return 0;
        // T in years, 1e18 scaled
        uint256 T    = timeToExpirySeconds * PRECISION / 365 days;
        uint256 sqrtT = _sqrt(T);
        uint256 ivSqrtT = iv * sqrtT / PRECISION;

        // d1 = (ln(S/K) + (r + iv²/2)*T) / (iv*√T)
        int256 lnSK  = _ln(spot * PRECISION / strike);
        uint256 iv2  = iv * iv / PRECISION;
        int256 drift = int256((R + iv2 / 2) * T / PRECISION);
        int256 d1    = (lnSK + drift) * int256(PRECISION) / int256(ivSqrtT);
        int256 d2    = d1 - int256(ivSqrtT);

        if (isCall) {
            uint256 nd1 = _cdf(d1);
            uint256 nd2 = _cdf(d2);
            uint256 discStrike = strike * _expNeg(R * T / PRECISION) / PRECISION;
            uint256 a = spot * nd1 / PRECISION;
            uint256 b = discStrike * nd2 / PRECISION;
            return a > b ? a - b : 0;
        } else {
            uint256 nd1neg = _cdf(-d1);
            uint256 nd2neg = _cdf(-d2);
            uint256 discStrike = strike * _expNeg(R * T / PRECISION) / PRECISION;
            uint256 a = discStrike * nd2neg / PRECISION;
            uint256 b = spot * nd1neg / PRECISION;
            return a > b ? a - b : 0;
        }
    }


    // ─── Pool: Deposit / Withdraw ─────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant notPaused {
        require(amount > 0, "zero amount");
        require(totalAssets + amount <= tvlCap, "tvl cap");

        uint256 shares;
        uint256 supply = ymusd.totalSupply();
        if (supply == 0 || totalAssets == 0) {
            shares = amount;
        } else {
            shares = amount * supply / totalAssets;
        }

        musd.safeTransferFrom(msg.sender, address(this), amount);
        totalAssets += amount;
        ymusd.mint(msg.sender, shares);

        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0, "zero shares");
        uint256 supply = ymusd.totalSupply();
        require(supply > 0, "no supply");

        uint256 musdOut = shares * totalAssets / supply;
        uint256 available = totalAssets - lockedCollateral;
        require(musdOut <= available, "insufficient liquidity");

        ymusd.burn(msg.sender, shares);
        totalAssets -= musdOut;
        musd.safeTransfer(msg.sender, musdOut);

        emit Withdrawn(msg.sender, shares, musdOut);
    }

    // ─── Collateral helpers ───────────────────────────────────────────────────

    function _callCollateral(uint256 spot, uint256 strike, uint256 quantity)
        internal pure returns (uint256)
    {
        uint256 cap = spot * 2 > strike ? spot * 2 - strike : 0;
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

    // ─── Fee helpers ──────────────────────────────────────────────────────────

    function _takePremiumFee(uint256 premium) internal returns (uint256 net) {
        uint256 fee = premium * protocolFeeBps / 10000;
        if (fee > 0) musd.safeTransfer(feeRecipient, fee);
        return premium - fee;
    }

    function _takePerformanceFee() internal {
        if (totalPremiumsEarned <= totalSettlementsPaid) return;
        uint256 netYield = totalPremiumsEarned - totalSettlementsPaid;
        uint256 fee = netYield * performanceFeeBps / 10000;
        if (fee > 0 && fee <= totalAssets) {
            totalAssets -= fee;
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

        userOptions[msg.sender].push(id);
        emit OrderCreated(id, optionType, msg.sender, true);

        // Attempt automatic pool fill
        _tryPoolFill(id);
    }

    function _tryPoolFill(uint256 id) internal {
        Option storage o = options[id];
        uint256 spot = _spot();

        // Validate premium against BS price (5% tolerance)
        // bsPrice returns per-BTC premium; scale by quantity
        uint256 fairUnit = bsPrice(o.optionType == OptionType.CALL, spot, o.strike, o.expiry - block.timestamp);
        uint256 fair     = fairUnit * o.quantity / PRECISION;
        if (o.premium < fair * 95 / 100) return; // below fair value, skip

        uint256 collateral = _requiredCollateral(o.optionType, spot, o.strike, o.quantity);
        require(collateral <= maxOptionCollateral, "collateral exceeds max");

        // Check pool has enough free capital
        if (totalAssets < lockedCollateral + collateral) return;
        if (totalAssets >= tvlCap) return;

        // Fill: credit premium to pool, lock collateral
        uint256 netPremium = _takePremiumFee(o.premium);
        totalAssets       += netPremium;
        totalPremiumsEarned += netPremium;
        lockedCollateral  += collateral;

        o.short        = address(this);
        o.filledByPool = true;
        o.collateral   = collateral;
        o.status       = OrderStatus.FILLED;

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

        userOptions[msg.sender].push(id);
        emit OrderCreated(id, optionType, msg.sender, false);
    }

    /// @notice Place a short order with Trove margin (EIP-712).
    function createShortOrderTrove(
        OptionType optionType,
        uint256    strike,
        uint256    quantity,
        uint256    expiry,
        uint256    premium,
        bytes calldata troveSig,
        uint256    troveDeadline
    ) external nonReentrant notPaused returns (uint256 id) {
        require(strike > 0 && quantity > 0 && premium > 0, "invalid params");
        require(expiry > block.timestamp + MIN_EXPIRY, "expiry too soon");
        require(expiry <= block.timestamp + MAX_EXPIRY, "expiry too far");
        require(troveSig.length > 0 && troveDeadline > block.timestamp, "invalid trove sig");

        uint256 spot       = _spot();
        uint256 collateral = _requiredCollateral(optionType, spot, strike, quantity);

        // Verify Trove equity covers collateral
        ITroveManager tm = ITroveManager(TROVE_MANAGER);
        require(tm.getTroveStatus(msg.sender) == 1, "no active trove");
        uint256 collVal = tm.getTroveColl(msg.sender) * spot / PRECISION;
        uint256 debt    = tm.getTroveDebt(msg.sender);
        require(collVal > debt, "trove underwater");
        require(collVal * PRECISION / debt >= MIN_ICR, "trove ICR too low");
        require(collVal - debt >= collateral, "insufficient trove equity");

        id = nextId++;
        Option storage o = options[id];
        o.id            = id;
        o.optionType    = optionType;
        o.status        = OrderStatus.OPEN;
        o.short         = msg.sender;
        o.strike        = strike;
        o.premium       = premium;
        o.quantity      = quantity;
        o.expiry        = expiry;
        o.collateral    = collateral;
        o.marginType    = MarginType.TROVE;
        o.troveSig      = troveSig;
        o.troveDeadline = troveDeadline;

        userOptions[msg.sender].push(id);
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
        userOptions[msg.sender].push(id);

        emit OrderFilled(id, msg.sender, false);
    }


    // ─── Settlement ───────────────────────────────────────────────────────────

    function settle(uint256 id) external nonReentrant {
        Option storage o = options[id];
        require(o.status == OrderStatus.FILLED, "not filled");
        require(msg.sender == o.long, "only long can settle");
        require(o.expiry > block.timestamp, "expired");

        uint256 spot   = _spot();
        uint256 profit = _profit(o, spot);
        require(profit > 0, "not in the money");

        o.status = OrderStatus.SETTLED;

        if (o.filledByPool) {
            require(profit <= o.collateral, "profit exceeds collateral");
            lockedCollateral -= o.collateral;
            totalAssets      -= profit;
            totalSettlementsPaid += profit;
            _takePerformanceFee();
            musd.safeTransfer(o.long, profit);
            // remaining collateral stays in pool
        } else if (o.marginType == MarginType.MUSD) {
            musd.safeTransfer(o.long, profit);
            uint256 remaining = o.collateral - profit;
            if (remaining > 0) musd.safeTransfer(o.short, remaining);
        } else {
            // Trove margin — pull from trove
            IBorrowerOperationsSignatures(BORROWER_OPS_SIGS).adjustTroveWithSignature(
                0, profit, true, address(0), address(0),
                o.short, address(this), o.troveSig, o.troveDeadline
            );
            musd.safeTransfer(o.long, profit);
        }

        emit Settled(id, o.long, profit);
    }

    function _profit(Option storage o, uint256 spot) internal view returns (uint256) {
        if (o.optionType == OptionType.CALL) {
            return spot > o.strike ? (spot - o.strike) * o.quantity / PRECISION : 0;
        } else {
            return o.strike > spot ? (o.strike - spot) * o.quantity / PRECISION : 0;
        }
    }

    // ─── Refund (expiry) ──────────────────────────────────────────────────────

    function refund(uint256 id) external nonReentrant {
        Option storage o = options[id];
        require(o.status == OrderStatus.FILLED, "not filled");
        require(block.timestamp >= o.expiry, "not expired");

        o.status = OrderStatus.REFUNDED;

        if (o.filledByPool) {
            lockedCollateral -= o.collateral;
            // collateral stays in pool as yield
            _takePerformanceFee();
        } else if (o.marginType == MarginType.MUSD) {
            musd.safeTransfer(o.short, o.collateral);
        }
        // Trove margin: nothing to return, lien released by status change

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
            if (o.marginType == MarginType.MUSD)
                musd.safeTransfer(o.short, o.collateral);
        } else {
            revert("not your order");
        }
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

    function getUserOptions(address user) external view returns (uint256[] memory) {
        return userOptions[user];
    }

    function spotPrice() external view returns (uint256) {
        return _spot();
    }

    function quotePremium(
        bool isCall, uint256 strike, uint256 quantity, uint256 expiry
    ) external view returns (uint256) {
        uint256 spot = _spot();
        uint256 unitPremium = bsPrice(isCall, spot, strike, expiry - block.timestamp);
        return unitPremium * quantity / PRECISION;
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function setIV(uint256 _iv) external onlyOwner {
        require(_iv >= 5e17 && _iv <= 15e17, "iv out of range");
        iv = _iv;
    }

    function setTVLCap(uint256 _cap) external onlyOwner { tvlCap = _cap; }

    function setMaxOptionCollateral(uint256 _max) external onlyOwner { maxOptionCollateral = _max; }

    function setFeeRecipient(address _r) external onlyOwner {
        require(_r != address(0), "zero address");
        feeRecipient = _r;
    }

    function setProtocolFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "max 5%");
        protocolFeeBps = _bps;
    }

    function setPerformanceFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 3000, "max 30%");
        performanceFeeBps = _bps;
    }

    function pausePool()   external onlyOwner { paused = true; }
    function unpausePool() external onlyOwner { paused = false; }
}
