//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "../musdContracts/UsingMUSD.sol";
import "./UsingPriceFeedTest.sol";
import "../safeMath/SafeMath.sol";

/**
 * @dev Test-only CallOption that injects the oracle address.
 * Identical logic to CallOption.sol; only the base class for price feed differs.
 */
contract CallOptionTest is UsingMUSD, UsingPriceFeedTest {
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
        uint256 settlementType;
        uint256 initialSellerMargin;
        uint256 strikePrice;
        uint256 cost;
        uint256 quantity;
        uint256 expiry;
    }

    mapping(uint256 => Option) public idToOption;
    mapping(address => uint256[]) public addressToOptions;

    constructor(address _musd, address _oracle)
        public
        UsingMUSD(_musd)
        UsingPriceFeedTest(_oracle)
    { uniqueId = 1; }

    function createNewOptionLong(uint256 _strikePrice, uint256 _cost, uint256 _quantity) external {
        bool ok = musdInstance.transferFrom(msg.sender, address(this), _cost);
        require(ok, "Insufficient MUSD approved for premium escrow");
        idToOption[uniqueId] = Option(true, false, msg.sender, address(0), POSITION.SHORT,
            uniqueId, 0, 0, _strikePrice, _cost, _quantity, block.timestamp + 2 days);
        addressToOptions[msg.sender].push(uniqueId++);
    }

    function createNewOptionShort(
        uint256 _type, uint256 _strikePrice, uint256 _cost,
        uint256 _quantity, uint256 _initialMargin
    ) external payable {
        require(_type == 0 || _type == 1, "Invalid settlement type");
        if (_type == 0) {
            require(msg.value == _quantity, "Incorrect BTC amount sent for escrow");
        } else {
            uint256 mv = _quantity.mul(getMarketValue()).div(10**18);
            require(_initialMargin >= mv.sub(mv.div(3)), "Insufficient MUSD margin");
            require(_strikePrice >= mv.div(3), "Strike too deep in the money");
            bool ok = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(ok, "Insufficient MUSD approved for margin escrow");
        }
        idToOption[uniqueId] = Option(true, false, address(0), msg.sender, POSITION.LONG,
            uniqueId, _type, _initialMargin, _strikePrice, _cost, _quantity, block.timestamp + 2 days);
        addressToOptions[msg.sender].push(uniqueId++);
    }

    function buyToOpen(uint256 _id) external isAvailable(idToOption[_id]) {
        Option storage o = idToOption[_id];
        require(o.openPosition == POSITION.LONG, "Wrong option selected");
        require(msg.sender != o.partyS, "Cannot fill your own order");
        bool ok = musdInstance.transferFrom(msg.sender, address(this), o.cost);
        require(ok, "Insufficient MUSD approved for premium");
        musdInstance.transfer(o.partyS, o.cost);
        o.isAvailable = false;
        o.partyL = msg.sender;
        addressToOptions[msg.sender].push(_id);
    }

    function sellToOpen(uint256 _id, uint256 _type, uint256 _initialMargin)
        external payable isAvailable(idToOption[_id])
    {
        require(_type == 0 || _type == 1, "Invalid settlement type");
        Option storage o = idToOption[_id];
        require(o.openPosition == POSITION.SHORT, "Wrong option selected");
        require(msg.sender != o.partyL, "Cannot fill your own order");
        if (_type == 0) {
            require(msg.value == o.quantity, "Incorrect BTC amount sent for escrow");
        } else {
            uint256 mv = o.quantity.mul(getMarketValue()).div(10**18);
            require(_initialMargin >= mv.sub(mv.div(3)), "Insufficient MUSD margin");
            require(o.strikePrice >= mv.div(3), "Strike too deep in the money");
            bool ok = musdInstance.transferFrom(msg.sender, address(this), _initialMargin);
            require(ok, "Insufficient MUSD approved for margin escrow");
        }
        musdInstance.transfer(msg.sender, o.cost);
        o.settlementType = _type;
        o.initialSellerMargin = _initialMargin;
        o.isAvailable = false;
        o.partyS = msg.sender;
        addressToOptions[msg.sender].push(_id);
    }

    function settleOption(uint256 _id) external hasNotSettled(idToOption[_id]) {
        Option storage o = idToOption[_id];
        uint256 mv = o.quantity.mul(getMarketValue()).div(10**18);
        require(mv > o.strikePrice, "Option is out of the money");
        require(msg.sender == o.partyL, "Only long party can settle");

        if (o.settlementType == 0) {
            bool ok = musdInstance.transferFrom(msg.sender, address(this), o.strikePrice);
            require(ok, "Insufficient MUSD approved for strike payment");
            address(uint160(msg.sender)).transfer(o.quantity);
            musdInstance.transfer(o.partyS, o.strikePrice);
        } else {
            uint256 profit = mv.sub(o.strikePrice);
            uint256 payout = profit < o.initialSellerMargin ? profit : o.initialSellerMargin;
            musdInstance.transfer(msg.sender, payout);
            uint256 remaining = o.initialSellerMargin.sub(payout);
            if (remaining > 0) musdInstance.transfer(o.partyS, remaining);
        }
        o.settled = true;
    }

    function closeOption(uint256 _id) external notFilledorExpired(idToOption[_id]) {
        Option storage o = idToOption[_id];
        if (o.openPosition == POSITION.LONG) {
            require(msg.sender == o.partyS, "Not authorised");
            if (o.settlementType == 0) address(uint160(msg.sender)).transfer(o.quantity);
            else musdInstance.transfer(msg.sender, o.initialSellerMargin);
        } else {
            require(msg.sender == o.partyL, "Not authorised");
            musdInstance.transfer(msg.sender, o.cost);
        }
        o.settled = true;
        o.isAvailable = false;
    }

    function refundExpired(uint256 _id) external isFilledandExpired(idToOption[_id]) {
        Option storage o = idToOption[_id];
        require(msg.sender == o.partyS, "Only short party can reclaim");
        if (o.settlementType == 0) address(uint160(msg.sender)).transfer(o.quantity);
        else musdInstance.transfer(msg.sender, o.initialSellerMargin);
        o.settled = true;
        o.isAvailable = false;
    }

    function getOptionsCount(address a) public view returns (uint256) {
        return addressToOptions[a].length;
    }

    modifier isAvailable(Option memory o) {
        require(o.isAvailable, "Option already filled or invalid");
        require(o.id != 0, "Invalid option id");
        require(o.expiry > block.timestamp, "Option has expired");
        _;
    }
    modifier hasNotSettled(Option memory o) {
        require(o.id != 0, "Invalid option id");
        require(!o.isAvailable, "Option not yet confirmed");
        require(!o.settled, "Option already settled");
        require(o.expiry > block.timestamp, "Option has expired");
        _;
    }
    modifier notFilledorExpired(Option memory o) {
        require(o.isAvailable, "Option already filled or invalid");
        require(o.id != 0, "Invalid option id");
        _;
    }
    modifier isFilledandExpired(Option memory o) {
        require(o.id != 0, "Invalid option");
        require(!o.isAvailable, "Option not filled");
        require(!o.settled, "Already settled");
        require(o.expiry < block.timestamp, "Not yet expired");
        _;
    }
}
