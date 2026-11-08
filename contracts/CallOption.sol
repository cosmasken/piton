//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "./musdContracts/UsingMUSD.sol";
import "./priceContract/UsingPriceFeed.sol";
import "./mezoContracts/UsingMezoTrove.sol";

/**
 * @title CallOption
 * @notice OTC Bitcoin call options settled in MUSD on Mezo.
 *         Underlying asset: BTC (native Mezo coin, sent as msg.value).
 *         Premium & margin : MUSD (Mezo's Bitcoin-backed stablecoin).
 *         Settlement types : 0 = BTC, 1 = MUSD, 2 = Trove equity lien.
 */
contract CallOption is UsingMUSD, UsingPriceFeed, UsingMezoTrove {
    using SafeMath for uint256;

    uint256 public uniqueId;

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
        // Trove margin fields (zero for types 0/1)
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
     * @notice Creates a new call option order for the Long/Buy position.
     * @param _strikePrice  Strike price in MUSD (10^18)
     * @param _cost         Premium bid in MUSD (10^18)
     * @param _quantity     Underlying BTC amount (Wei)
     */
    function createNewOptionLong(
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
            uniqueId, 0, 0,
            _strikePrice, _cost, _quantity,
            _expiry,
            "", 0
        );
        addressToOptions[msg.sender].push(uniqueId);
        uniqueId++;
    }

    /*
     * @notice Creates a new call option short order.
     * @param _type           0=BTC  1=MUSD  2=Trove
     * @param _strikePrice    Strike price in MUSD (10^18)
     * @param _cost           Premium ask in MUSD (10^18)
     * @param _quantity       Underlying BTC amount (Wei)
     * @param _initialMargin  MUSD margin (type 1 only; 0 for types 0/2)
     * @param _troveSig       EIP-712 adjustTroveWithSignature payload (type 2 only)
     * @param _troveDeadline  Signature deadline (type 2 only)
     */
    function createNewOptionShort(
        uint256 _type,
        uint256 _strikePrice,
        uint256 _cost,
        uint256 _quantity,
        uint256 _initialMargin,
        uint256 _expiry,
        bytes   calldata _troveSig,
        uint256 _troveDeadline
    ) external payable {
        require(_type <= 2, "Invalid settlement type");
        require(_expiry > block.timestamp, "Expiry must be in the future");
        require(_expiry <= block.timestamp + 30 days, "Expiry too far");
        uint256 mv = _quantity.mul(getMarketValue()).div(10**18);

        if (_type == 0) {
            require(msg.value == _quantity, "Incorrect BTC amount sent for escrow");
        } else if (_type == 1) {
            uint256 required = mv.sub(mv.div(3));
            require(_initialMargin >= required, "Insufficient MUSD margin");
            require(_strikePrice >= mv.div(3), "Strike too deep in the money");
            bool ok = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(ok, "Insufficient MUSD approved for margin escrow");
        } else {
            // type 2: Trove equity lien — no tokens move, verify coverage now
            uint256 required = mv.sub(mv.div(3));
            require(_strikePrice >= mv.div(3), "Strike too deep in the money");
            require(troveCoversMargin(msg.sender, required, getMarketValue()), "Trove equity insufficient");
            require(_troveSig.length > 0 && _troveDeadline > block.timestamp, "Invalid trove signature");
        }

        idToOption[uniqueId] = Option(
            true, false,
            address(0), msg.sender,
            POSITION.LONG,
            uniqueId, _type, _initialMargin,
            _strikePrice, _cost, _quantity,
            _expiry,
            _troveSig, _troveDeadline
        );
        addressToOptions[msg.sender].push(uniqueId);
        uniqueId++;
    }

    /*
     * @notice Join a shorted order (buy the long position).
     * @param _id  Option ID to join
     */
    function buyToOpen(uint256 _id) external isAvailable(idToOption[_id]) {
        Option storage option = idToOption[_id];

        require(option.openPosition == POSITION.LONG, "Wrong option selected");
        require(msg.sender != option.partyS, "Cannot fill your own order");

        // For Trove margin: re-verify equity is still sufficient at fill time
        if (option.settlementType == 2) {
            uint256 mv = option.quantity.mul(getMarketValue()).div(10**18);
            uint256 required = mv.sub(mv.div(3));
            require(troveCoversMargin(option.partyS, required, getMarketValue()), "Trove equity insufficient at fill");
        }

        bool ok = musdInstance.transferFrom(msg.sender, address(this), option.cost);
        require(ok, "Insufficient MUSD approved for premium");
        musdInstance.transfer(option.partyS, option.cost);

        option.isAvailable = false;
        option.partyL = msg.sender;
        addressToOptions[msg.sender].push(_id);
    }

    /*
     * @notice Sell to an existing long bid (take the short position).
     * @param _id             Option ID to fill
     * @param _type           0=BTC  1=MUSD  2=Trove
     * @param _initialMargin  MUSD margin (type 1 only)
     * @param _troveSig       EIP-712 payload (type 2 only)
     * @param _troveDeadline  Signature deadline (type 2 only)
     */
    function sellToOpen(
        uint256 _id,
        uint256 _type,
        uint256 _initialMargin,
        bytes   calldata _troveSig,
        uint256 _troveDeadline
    ) external payable isAvailable(idToOption[_id]) {
        require(_type <= 2, "Invalid settlement type");
        Option storage option = idToOption[_id];
        require(option.openPosition == POSITION.SHORT, "Wrong option selected");
        require(msg.sender != option.partyL, "Cannot fill your own order");

        uint256 mv = option.quantity.mul(getMarketValue()).div(10**18);

        if (_type == 0) {
            require(msg.value == option.quantity, "Incorrect BTC amount sent for escrow");
        } else if (_type == 1) {
            uint256 required = mv.sub(mv.div(3));
            require(_initialMargin >= required, "Insufficient MUSD margin");
            require(option.strikePrice >= mv.div(3), "Strike too deep in the money");
            bool ok = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(ok, "Insufficient MUSD approved for margin escrow");
        } else {
            uint256 required = mv.sub(mv.div(3));
            require(option.strikePrice >= mv.div(3), "Strike too deep in the money");
            require(troveCoversMargin(msg.sender, required, getMarketValue()), "Trove equity insufficient");
            require(_troveSig.length > 0 && _troveDeadline > block.timestamp, "Invalid trove signature");
        }

        musdInstance.transfer(msg.sender, option.cost);

        option.settlementType     = _type;
        option.initialSellerMargin = _initialMargin;
        option.isAvailable        = false;
        option.partyS             = msg.sender;
        option.troveSignature     = _troveSig;
        option.troveDeadline      = _troveDeadline;
        addressToOptions[msg.sender].push(_id);
    }

    /*
     * @notice Settles a filled, in-the-money call option.
     * @param _id  Option ID to settle
     */
    function settleOption(uint256 _id) external hasNotSettled(idToOption[_id]) {
        Option storage option = idToOption[_id];

        uint256 mv = option.quantity.mul(getMarketValue()).div(10**18);
        require(mv > option.strikePrice, "Option is out of the money");
        require(msg.sender == option.partyL, "Only long party can settle");

        if (option.settlementType == 0) {
            bool ok = musdInstance.transferFrom(msg.sender, address(this), option.strikePrice);
            require(ok, "Insufficient MUSD approved for strike payment");
            address(uint160(msg.sender)).transfer(option.quantity);
            musdInstance.transfer(option.partyS, option.strikePrice);

        } else if (option.settlementType == 1) {
            uint256 profit = mv.sub(option.strikePrice);
            uint256 payout = profit < option.initialSellerMargin ? profit : option.initialSellerMargin;
            musdInstance.transfer(msg.sender, payout);
            uint256 remaining = option.initialSellerMargin.sub(payout);
            if (remaining > 0) musdInstance.transfer(option.partyS, remaining);

        } else {
            // Trove margin: pull profit from short's Trove via pre-signed payload.
            // If Trove was liquidated, treat as expired — long gets premium back.
            ITroveManager tm = ITroveManager(TROVE_MANAGER);
            if (tm.getTroveStatus(option.partyS) != 1) {
                // Trove liquidated — mark settled, long loses premium (already paid to short at fill)
                option.settled = true;
                return;
            }
            uint256 profit = mv.sub(option.strikePrice);
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
            if (option.settlementType == 0) {
                address(uint160(msg.sender)).transfer(option.quantity);
            } else if (option.settlementType == 1) {
                musdInstance.transfer(msg.sender, option.initialSellerMargin);
            }
            // type 2: no escrow to return
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

        if (option.settlementType == 0) {
            address(uint160(option.partyS)).transfer(option.quantity);
        } else if (option.settlementType == 1) {
            musdInstance.transfer(option.partyS, option.initialSellerMargin);
        }
        // type 2: Trove lien released by marking settled — no tokens to return
    }

    /*
     * @notice Returns the number of options associated with an address.
     */
    function getOptionsCount(address _address) public view returns (uint256) {
        return addressToOptions[_address].length;
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
