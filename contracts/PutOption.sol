//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "./musdContracts/UsingMUSD.sol";
import "./priceContract/UsingPriceFeed.sol";
import "./mezoContracts/UsingMezoTrove.sol";

/**
 * @title PutOption
 * @notice OTC Bitcoin put options settled in MUSD on Mezo.
 *         Underlying asset: BTC (native Mezo coin).
 *         Premium & margin : MUSD (Mezo's Bitcoin-backed stablecoin).
 *         Settlement types : 0 = BTC, 1 = MUSD, 2 = Trove equity lien.
 */
contract PutOption is UsingMUSD, UsingPriceFeed, UsingMezoTrove {
    using SafeMath for uint256;

    uint256 public uniqueId;

    mapping(address => uint256) public pendingBTC;

    enum POSITION {LONG, SHORT}

    struct Option {
        bool isAvailable;
        bool settled;
        address partyL;
        address partyS;
        POSITION openPosition;
        uint256 id;
        uint256 settlementType;   // 0=BTC 1=MUSD 2=Trove
        uint256 initialSellerMargin;
        uint256 strikePrice;
        uint256 cost;
        uint256 quantity;
        uint256 expiry;
        bytes   troveSignature;
        uint256 troveDeadline;
    }

    mapping(uint256 => Option) public idToOption;
    mapping(address => uint256[]) public addressToOptions;

    constructor(address _musdAddress)
        public
        UsingMUSD(_musdAddress)
        UsingPriceFeed()
    {
        uniqueId = 1;
    }

    /*
     * @notice Creates a new put option order for the Long/Buy position.
     * @param _type        Settlement type: 0=BTC 1=MUSD (chosen by long)
     * @param _strikePrice Strike price in MUSD (10^18)
     * @param _cost        Premium bid in MUSD (10^18)
     * @param _quantity    Underlying BTC amount (Wei)
     */
    function createNewOptionLong(
        uint256 _type,
        uint256 _strikePrice,
        uint256 _cost,
        uint256 _quantity,
        uint256 _expiry
    ) external {
        require(_expiry > block.timestamp, "Expiry must be in the future");
        require(_expiry <= block.timestamp + 30 days, "Expiry too far");
        bool ok = musdInstance.transferFrom(msg.sender, address(this), _cost);
        require(ok, "Insufficient MUSD approved for premium escrow");

        idToOption[uniqueId] = Option(
            true, false,
            msg.sender, address(0),
            POSITION.SHORT,
            uniqueId, _type, 0,
            _strikePrice, _cost, _quantity,
            _expiry,
            "", 0
        );
        addressToOptions[msg.sender].push(uniqueId);
        uniqueId++;
    }

    /*
     * @notice Creates a new put option short order.
     * @param _strikePrice   Strike price in MUSD (10^18)
     * @param _cost          Premium ask in MUSD (10^18)
     * @param _quantity      Underlying BTC amount (Wei)
     * @param _initialMargin MUSD margin >= strikePrice (type 1 only; 0 for type 2)
     * @param _troveSig      EIP-712 adjustTroveWithSignature payload (type 2 only)
     * @param _troveDeadline Signature deadline (type 2 only)
     */
    function createNewOptionShort(
        uint256 _strikePrice,
        uint256 _cost,
        uint256 _quantity,
        uint256 _initialMargin,
        uint256 _expiry,
        bytes   calldata _troveSig,
        uint256 _troveDeadline
    ) external {
        require(_expiry > block.timestamp, "Expiry must be in the future");
        require(_expiry <= block.timestamp + 30 days, "Expiry too far");
        uint256 marginType = (_troveSig.length > 0) ? 2 : 1;

        if (marginType == 1) {
            require(_initialMargin >= _strikePrice, "Insufficient MUSD margin");
            bool ok = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(ok, "Insufficient MUSD approved for margin escrow");
        } else {
            require(troveCoversMargin(msg.sender, _strikePrice, getMarketValue()), "Trove equity insufficient");
            require(_troveDeadline > block.timestamp, "Invalid trove deadline");
        }

        idToOption[uniqueId] = Option(
            true, false,
            address(0), msg.sender,
            POSITION.LONG,
            uniqueId, marginType, _initialMargin,
            _strikePrice, _cost, _quantity,
            _expiry,
            _troveSig, _troveDeadline
        );
        addressToOptions[msg.sender].push(uniqueId);
        uniqueId++;
    }

    /*
     * @notice Join a shorted put order (buy the long position).
     * @param _id    Option ID to join
     * @param _type  Settlement type for the long side: 0=BTC 1=MUSD
     */
    function buyToOpen(uint256 _id, uint256 _type) external isAvailable(idToOption[_id]) {
        Option storage option = idToOption[_id];

        require(option.openPosition == POSITION.LONG, "Wrong option selected");
        require(msg.sender != option.partyS, "Cannot fill your own order");

        if (option.settlementType == 2) {
            require(troveCoversMargin(option.partyS, option.strikePrice, getMarketValue()), "Trove equity insufficient at fill");
        }

        bool ok = musdInstance.transferFrom(msg.sender, address(this), option.cost);
        require(ok, "Insufficient MUSD approved for premium");
        musdInstance.transfer(option.partyS, option.cost);

        option.isAvailable = false;
        option.partyL = msg.sender;
        // For Trove margin the settlement type (BTC/MUSD delivery) is set by the long
        if (option.settlementType != 2) option.settlementType = _type;
        addressToOptions[msg.sender].push(_id);
    }

    /*
     * @notice Sell to an existing long put bid (take the short position).
     * @param _id             Option ID to fill
     * @param _initialMargin  MUSD margin >= strikePrice (type 1); 0 for type 2
     * @param _troveSig       EIP-712 payload (type 2 only)
     * @param _troveDeadline  Signature deadline (type 2 only)
     */
    function sellToOpen(
        uint256 _id,
        uint256 _initialMargin,
        bytes   calldata _troveSig,
        uint256 _troveDeadline
    ) external isAvailable(idToOption[_id]) {
        Option storage option = idToOption[_id];

        require(option.openPosition == POSITION.SHORT, "Wrong option selected");
        require(msg.sender != option.partyL, "Cannot fill your own order");

        uint256 marginType = (_troveSig.length > 0) ? 2 : 1;

        if (marginType == 1) {
            require(_initialMargin >= option.strikePrice, "Insufficient MUSD margin");
            bool ok = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(ok, "Insufficient MUSD approved for margin escrow");
        } else {
            require(troveCoversMargin(msg.sender, option.strikePrice, getMarketValue()), "Trove equity insufficient");
            require(_troveDeadline > block.timestamp, "Invalid trove deadline");
        }

        musdInstance.transfer(msg.sender, option.cost);

        option.initialSellerMargin = _initialMargin;
        // Preserve the long's delivery type; only override to 2 for Trove margin
        if (marginType == 2) option.settlementType = 2;
        option.isAvailable         = false;
        option.partyS              = msg.sender;
        option.troveSignature      = _troveSig;
        option.troveDeadline       = _troveDeadline;
        addressToOptions[msg.sender].push(_id);
    }

    /*
     * @notice Settles a filled, in-the-money put option.
     * @dev For settlement type 0, caller must send BTC equal to quantity as msg.value.
     * @param _id  Option ID to settle
     */
    function settleOption(uint256 _id) external payable hasNotSettled(idToOption[_id]) {
        Option storage option = idToOption[_id];

        uint256 mv = option.quantity.mul(getMarketValue()).div(10**18);
        require(option.strikePrice > mv, "Option is out of the money");
        require(msg.sender == option.partyL, "Only long party can settle");

        if (option.settlementType == 0) {
            require(msg.value == option.quantity, "Incorrect BTC amount sent");
            pendingBTC[option.partyS] = pendingBTC[option.partyS].add(option.quantity);
            musdInstance.transfer(option.partyL, option.strikePrice);

        } else if (option.settlementType == 1) {
            uint256 profit = option.strikePrice.sub(mv);
            musdInstance.transfer(msg.sender, profit);
            musdInstance.transfer(option.partyS, option.initialSellerMargin.sub(profit));

        } else {
            // Trove margin: pull strike MUSD from short's Trove
            ITroveManager tm = ITroveManager(TROVE_MANAGER);
            if (tm.getTroveStatus(option.partyS) != 1) {
                option.settled = true;
                return;
            }
            uint256 profit = option.strikePrice.sub(mv);
            uint256 equity = troveEquityMUSD(option.partyS, getMarketValue());
            uint256 payout = profit < equity ? profit : equity;
            require(payout > 0, "No equity available");
            _pullFromTrove(option.partyS, payout, option.troveSignature, option.troveDeadline);
            musdInstance.transfer(msg.sender, payout);
        }

        option.settled = true;
    }

    /*
     * @notice Closes an unfilled or expired option and refunds escrow.
     * @param _id  Option ID to close
     */
    function closeOption(uint256 _id) external notFilledorExpired(idToOption[_id]) {
        Option storage option = idToOption[_id];

        if (option.openPosition == POSITION.LONG) {
            require(msg.sender == option.partyS, "Not authorised");
            if (option.settlementType == 1) {
                musdInstance.transfer(msg.sender, option.initialSellerMargin);
            }
            // type 2: no escrowed tokens
        } else {
            require(msg.sender == option.partyL, "Not authorised");
            musdInstance.transfer(msg.sender, option.cost);
        }

        option.settled = true;
        option.isAvailable = false;
    }

    /*
     * @notice Refunds escrow for filled but expired and unsettled options.
     * @param _id  Option ID to refund
     */
    function refundExpired(uint256 _id) external isFilledandExpired(idToOption[_id]) {
        Option storage option = idToOption[_id];

        option.settled = true;
        option.isAvailable = false;

        musdInstance.transfer(option.partyL, option.cost);

        if (option.settlementType == 1) {
            musdInstance.transfer(option.partyS, option.initialSellerMargin);
        }
        // type 2: Trove lien released by marking settled
    }

    /*
     * @notice Returns the number of options associated with an address.
     */
    function getOptionsCount(address _address) public view returns (uint256) {
        return addressToOptions[_address].length;
    }

    /*
     * @notice Withdraws BTC credited via pull-payment from BTC-settled put exercises.
     */
    function withdrawBTC() external {
        uint256 amount = pendingBTC[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingBTC[msg.sender] = 0;
        address(uint160(msg.sender)).transfer(amount);
    }

    // ── modifiers ────────────────────────────────────────────────────────────

    modifier isAvailable(Option memory option) {
        require(option.isAvailable, "Option already filled or invalid");
        require(option.id != 0, "Invalid option id");
        require(option.expiry > block.timestamp, "Option has expired");
        _;
    }

    modifier hasNotSettled(Option memory option) {
        require(option.id != 0, "Invalid option id");
        require(!option.isAvailable, "Option not yet confirmed");
        require(!option.settled, "Option already settled");
        require(option.expiry > block.timestamp, "Option has expired");
        _;
    }

    modifier notFilledorExpired(Option memory option) {
        require(option.isAvailable, "Option already filled or invalid");
        require(option.id != 0, "Invalid option id");
        _;
    }

    modifier isFilledandExpired(Option memory option) {
        require(option.id != 0, "Invalid option");
        require(!option.isAvailable, "Option not filled");
        require(!option.settled, "Already settled");
        require(option.expiry < block.timestamp, "Not yet expired");
        _;
    }
}
