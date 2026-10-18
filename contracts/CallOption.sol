//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "./musdContracts/UsingMUSD.sol";
import "./priceContract/UsingPriceFeed.sol";

/**
 * @title CallOption
 * @notice OTC Bitcoin call options settled in MUSD on Mezo.
 *         Underlying asset: BTC (native Mezo coin, sent as msg.value).
 *         Premium & margin : MUSD (Mezo's Bitcoin-backed stablecoin).
 *         Settlement types : 0 = BTC, 1 = MUSD.
 */
contract CallOption is UsingMUSD, UsingPriceFeed {
    using SafeMath for uint256;

    uint256 public uniqueId;

    enum POSITION {LONG, SHORT}

    /*
     * partyL          - address for long position
     * partyS          - address for short position
     * settlementType  - 0: BTC, 1: MUSD
     * cost            - bid/ask premium (10^18 MUSD format)
     * quantity        - underlying BTC amount (Wei / satoshi-equivalent)
     * expiry          - 48 hours from the time of creation
     * openPosition    - Long/Short position the counterparty would be taking
     */
    struct Option {
        bool isAvailable;
        bool settled;
        address partyL;
        address partyS;
        POSITION openPosition;
        uint256 id;
        uint256 settlementType;
        uint256 initialSellerMargin;
        uint256 strikePrice;
        uint256 cost;
        uint256 quantity;
        uint256 expiry;
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
     * @dev Must be preceded by an approve() call to the MUSD token contract.
     * @param _strikePrice  Strike price in MUSD (10^18)
     * @param _cost         Premium bid in MUSD (10^18)
     * @param _quantity     Underlying BTC amount (Wei)
     */
    function createNewOptionLong(
        uint256 _strikePrice,
        uint256 _cost,
        uint256 _quantity
    ) external {
        bool _costEscrowed = musdInstance.transferFrom(msg.sender, address(this), _cost);
        require(_costEscrowed, "Insufficient MUSD approved for premium escrow");

        Option memory newOption = Option(
            true, false,
            msg.sender, address(0),
            POSITION.SHORT,
            uniqueId, 0, 0,
            _strikePrice, _cost, _quantity,
            now + 2 days
        );

        idToOption[uniqueId] = newOption;
        addressToOptions[msg.sender].push(uniqueId);
        uniqueId++;
    }

    /*
     * @notice Creates a new call option order for the Sell/Short position.
     * @dev For type 1 (MUSD margin), must be preceded by an approve() call.
     * @param _type           Settlement type: 0 = BTC, 1 = MUSD
     * @param _strikePrice    Strike price in MUSD (10^18)
     * @param _cost           Premium ask in MUSD (10^18)
     * @param _quantity       Underlying BTC amount (Wei)
     * @param _initialMargin  MUSD margin amount (only used for type 1)
     */
    function createNewOptionShort(
        uint256 _type,
        uint256 _strikePrice,
        uint256 _cost,
        uint256 _quantity,
        uint256 _initialMargin
    ) external payable {
        require(_type == 0 || _type == 1, "Invalid settlement type");

        if (_type == 0) {
            require(msg.value == _quantity, "Incorrect BTC amount sent for escrow");
        } else {
            uint256 marketVal = _quantity.mul(getMarketValue()).div(10**18);
            uint256 requiredMargin = marketVal.sub(marketVal.div(3));
            require(_initialMargin >= requiredMargin, "Insufficient MUSD margin");

            bool _marginEscrowed = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(_marginEscrowed, "Insufficient MUSD approved for margin escrow");
        }

        Option memory newOption = Option(
            true, false,
            address(0), msg.sender,
            POSITION.LONG,
            uniqueId, _type, _initialMargin,
            _strikePrice, _cost, _quantity,
            now + 2 days
        );

        idToOption[uniqueId] = newOption;
        addressToOptions[msg.sender].push(uniqueId);
        uniqueId++;
    }

    /*
     * @notice Join a shorted order (buy the long position).
     * @dev Must be preceded by an approve() call to the MUSD token contract.
     * @param _id  Option ID to join
     */
    function buyToOpen(uint256 _id) external isAvailable(idToOption[_id]) {
        Option storage option = idToOption[_id];

        require(option.openPosition == POSITION.LONG, "Wrong option selected");
        require(msg.sender != option.partyS, "Cannot fill your own order");

        bool _premiumSent = musdInstance.transferFrom(msg.sender, address(this), option.cost);
        require(_premiumSent, "Insufficient MUSD approved for premium");

        musdInstance.transfer(option.partyS, option.cost);

        option.isAvailable = false;
        option.partyL = msg.sender;
        addressToOptions[msg.sender].push(_id);
    }

    /*
     * @notice Sell to an existing long bid (take the short position).
     * @dev For type 1, must be preceded by an approve() call.
     * @param _id             Option ID to fill
     * @param _type           Settlement type: 0 = BTC, 1 = MUSD
     * @param _initialMargin  MUSD margin (type 1 only)
     */
    function sellToOpen(
        uint256 _id,
        uint256 _type,
        uint256 _initialMargin
    ) external payable isAvailable(idToOption[_id]) {
        require(_type == 0 || _type == 1, "Invalid settlement type");

        Option storage option = idToOption[_id];

        require(option.openPosition == POSITION.SHORT, "Wrong option selected");
        require(msg.sender != option.partyL, "Cannot fill your own order");

        if (_type == 0) {
            require(msg.value == option.quantity, "Incorrect BTC amount sent for escrow");
        } else {
            uint256 marketVal = option.quantity.mul(getMarketValue()).div(10**18);
            uint256 requiredMargin = marketVal.sub(marketVal.div(3));
            require(_initialMargin >= requiredMargin, "Insufficient MUSD margin");

            bool _marginEscrowed = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(_marginEscrowed, "Insufficient MUSD approved for margin escrow");
        }

        musdInstance.transfer(msg.sender, option.cost);

        option.settlementType = _type;
        option.initialSellerMargin = _initialMargin;
        option.isAvailable = false;
        option.partyS = msg.sender;
        addressToOptions[msg.sender].push(_id);
    }

    /*
     * @notice Settles a filled, in-the-money call option.
     * @dev For type 0, must be preceded by approve(strikePrice) on MUSD.
     * @param _id  Option ID to settle
     */
    function settleOption(uint256 _id) external hasNotSettled(idToOption[_id]) {
        Option storage option = idToOption[_id];

        uint256 marketVal = option.quantity.mul(getMarketValue()).div(10**18);
        require(marketVal > option.strikePrice, "Option is out of the money");
        require(msg.sender == option.partyL, "Only long party can settle");

        if (option.settlementType == 0) {
            // BTC settlement: long pays strike in MUSD, receives BTC
            bool _escrowed = musdInstance.transferFrom(msg.sender, address(this), option.strikePrice);
            require(_escrowed, "Insufficient MUSD approved for strike payment");

            address(uint160(msg.sender)).transfer(option.quantity);
            musdInstance.transfer(option.partyS, option.strikePrice);
        } else {
            // MUSD settlement: long receives profit in MUSD from seller's margin
            uint256 profit = marketVal.sub(option.strikePrice);
            musdInstance.transfer(msg.sender, profit);

            uint256 remaining = option.initialSellerMargin.sub(profit);
            musdInstance.transfer(option.partyS, remaining);
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
            } else {
                musdInstance.transfer(msg.sender, option.initialSellerMargin);
            }
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

        require(msg.sender == option.partyS, "Only short party can reclaim");

        if (option.settlementType == 0) {
            address(uint160(msg.sender)).transfer(option.quantity);
        } else {
            musdInstance.transfer(msg.sender, option.initialSellerMargin);
        }

        option.settled = true;
        option.isAvailable = false;
    }

    /*
     * @notice Returns the number of options associated with an address.
     * @param _address  Wallet address to query
     */
    function getOptionsCount(address _address) public view returns (uint256) {
        return addressToOptions[_address].length;
    }

    // ── modifiers ────────────────────────────────────────────────────────────

    modifier isAvailable(Option memory option) {
        require(option.isAvailable, "Option already filled or invalid");
        require(option.id != 0, "Invalid option id");
        require(option.expiry > now, "Option has expired");
        _;
    }

    modifier hasNotSettled(Option memory option) {
        require(option.id != 0, "Invalid option id");
        require(!option.isAvailable, "Option not yet confirmed");
        require(!option.settled, "Option already settled");
        require(option.expiry > now, "Option has expired");
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
        require(option.expiry < now, "Not yet expired");
        _;
    }
}
