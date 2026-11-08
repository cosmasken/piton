//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "../musdContracts/UsingMUSD.sol";
import "./UsingPriceFeedTest.sol";
import "./UsingMezoTroveTest.sol";
import "../safeMath/SafeMath.sol";

contract CallOptionTest is UsingMUSD, UsingPriceFeedTest, UsingMezoTroveTest {
    using SafeMath for uint256;

    uint256 public uniqueId;
    enum POSITION {LONG, SHORT}

    struct Option {
        bool isAvailable; bool settled;
        address partyL; address partyS;
        POSITION openPosition;
        uint256 id; uint256 settlementType; uint256 initialSellerMargin;
        uint256 strikePrice; uint256 cost; uint256 quantity; uint256 expiry;
        bytes troveSignature; uint256 troveDeadline;
    }

    mapping(uint256 => Option) public idToOption;
    mapping(address => uint256[]) public addressToOptions;

    constructor(address _musd, address _oracle, address _tm, address _bos)
        public
        UsingMUSD(_musd)
        UsingPriceFeedTest(_oracle)
        UsingMezoTroveTest(_tm, _bos)
    { uniqueId = 1; }

    function createNewOptionLong(uint256 _sp, uint256 _cost, uint256 _qty) external {
        require(musdInstance.transferFrom(msg.sender, address(this), _cost), "premium escrow");
        idToOption[uniqueId] = Option(true, false, msg.sender, address(0), POSITION.SHORT,
            uniqueId, 0, 0, _sp, _cost, _qty, block.timestamp + 2 days, "", 0);
        addressToOptions[msg.sender].push(uniqueId++);
    }

    function createNewOptionShort(
        uint256 _type, uint256 _sp, uint256 _cost, uint256 _qty,
        uint256 _margin, bytes calldata _sig, uint256 _dl
    ) external payable {
        require(_type <= 2, "bad type");
        uint256 mv = _qty.mul(getMarketValue()).div(10**18);
        if (_type == 0) {
            require(msg.value == _qty, "btc escrow");
        } else if (_type == 1) {
            require(_margin >= mv.sub(mv.div(3)), "margin low");
            require(_sp >= mv.div(3), "deep ITM");
            require(musdInstance.transferFrom(msg.sender, address(this), _margin), "margin escrow");
        } else {
            require(troveCoversMargin(msg.sender, mv.sub(mv.div(3)), getMarketValue()), "trove low");
            require(_sp >= mv.div(3), "deep ITM");
            require(_sig.length > 0 && _dl > block.timestamp, "bad sig");
        }
        idToOption[uniqueId] = Option(true, false, address(0), msg.sender, POSITION.LONG,
            uniqueId, _type, _margin, _sp, _cost, _qty, block.timestamp + 2 days, _sig, _dl);
        addressToOptions[msg.sender].push(uniqueId++);
    }

    function buyToOpen(uint256 _id) external isAvailable(idToOption[_id]) {
        Option storage o = idToOption[_id];
        require(o.openPosition == POSITION.LONG && msg.sender != o.partyS, "bad fill");
        if (o.settlementType == 2) {
            uint256 mv = o.quantity.mul(getMarketValue()).div(10**18);
            require(troveCoversMargin(o.partyS, mv.sub(mv.div(3)), getMarketValue()), "trove low at fill");
        }
        require(musdInstance.transferFrom(msg.sender, address(this), o.cost), "premium");
        musdInstance.transfer(o.partyS, o.cost);
        o.isAvailable = false; o.partyL = msg.sender;
        addressToOptions[msg.sender].push(_id);
    }

    function sellToOpen(uint256 _id, uint256 _type, uint256 _margin, bytes calldata _sig, uint256 _dl)
        external payable isAvailable(idToOption[_id])
    {
        Option storage o = idToOption[_id];
        require(o.openPosition == POSITION.SHORT && msg.sender != o.partyL, "bad fill");
        uint256 mv = o.quantity.mul(getMarketValue()).div(10**18);
        if (_type == 0) {
            require(msg.value == o.quantity, "btc escrow");
        } else if (_type == 1) {
            require(_margin >= mv.sub(mv.div(3)), "margin low");
            require(o.strikePrice >= mv.div(3), "deep ITM");
            require(musdInstance.transferFrom(msg.sender, address(this), _margin), "margin escrow");
        } else {
            require(troveCoversMargin(msg.sender, mv.sub(mv.div(3)), getMarketValue()), "trove low");
            require(o.strikePrice >= mv.div(3), "deep ITM");
            require(_sig.length > 0 && _dl > block.timestamp, "bad sig");
        }
        musdInstance.transfer(msg.sender, o.cost);
        o.settlementType = _type; o.initialSellerMargin = _margin;
        o.isAvailable = false; o.partyS = msg.sender;
        o.troveSignature = _sig; o.troveDeadline = _dl;
        addressToOptions[msg.sender].push(_id);
    }

    function settleOption(uint256 _id) external hasNotSettled(idToOption[_id]) {
        Option storage o = idToOption[_id];
        uint256 mv = o.quantity.mul(getMarketValue()).div(10**18);
        require(mv > o.strikePrice, "OTM");
        require(msg.sender == o.partyL, "not long");

        if (o.settlementType == 0) {
            require(musdInstance.transferFrom(msg.sender, address(this), o.strikePrice), "strike payment");
            address(uint160(msg.sender)).transfer(o.quantity);
            musdInstance.transfer(o.partyS, o.strikePrice);
        } else if (o.settlementType == 1) {
            uint256 profit = mv.sub(o.strikePrice);
            uint256 payout = profit < o.initialSellerMargin ? profit : o.initialSellerMargin;
            musdInstance.transfer(msg.sender, payout);
            uint256 rem = o.initialSellerMargin.sub(payout);
            if (rem > 0) musdInstance.transfer(o.partyS, rem);
        } else {
            ITroveManagerT tm = ITroveManagerT(TROVE_MANAGER);
            if (tm.getTroveStatus(o.partyS) != 1) {
                o.settled = true; return;
            }
            uint256 profit = mv.sub(o.strikePrice);
            uint256 equity = troveEquityMUSD(o.partyS, getMarketValue());
            uint256 payout = profit < equity ? profit : equity;
            require(payout > 0, "no equity");
            _pullFromTrove(o.partyS, payout, o.troveSignature, o.troveDeadline);
            musdInstance.transfer(msg.sender, payout);
        }
        o.settled = true;
    }

    function closeOption(uint256 _id) external notFilledorExpired(idToOption[_id]) {
        Option storage o = idToOption[_id];
        if (o.openPosition == POSITION.LONG) {
            require(msg.sender == o.partyS, "not auth");
            if (o.settlementType == 0) address(uint160(msg.sender)).transfer(o.quantity);
            else if (o.settlementType == 1) musdInstance.transfer(msg.sender, o.initialSellerMargin);
        } else {
            require(msg.sender == o.partyL, "not auth");
            musdInstance.transfer(msg.sender, o.cost);
        }
        o.settled = true; o.isAvailable = false;
    }

    function refundExpired(uint256 _id) external isFilledandExpired(idToOption[_id]) {
        Option storage o = idToOption[_id];
        o.settled = true; o.isAvailable = false;
        musdInstance.transfer(o.partyL, o.cost);
        if (o.settlementType == 0) address(uint160(o.partyS)).transfer(o.quantity);
        else if (o.settlementType == 1) musdInstance.transfer(o.partyS, o.initialSellerMargin);
    }

    function getOptionsCount(address a) public view returns (uint256) { return addressToOptions[a].length; }

    modifier isAvailable(Option memory o) {
        require(o.isAvailable && o.id != 0 && o.expiry > block.timestamp, "unavailable"); _;
    }
    modifier hasNotSettled(Option memory o) {
        require(o.id != 0 && !o.isAvailable && !o.settled && o.expiry > block.timestamp, "bad state"); _;
    }
    modifier notFilledorExpired(Option memory o) {
        require(o.isAvailable && o.id != 0, "filled/invalid"); _;
    }
    modifier isFilledandExpired(Option memory o) {
        require(o.id != 0 && !o.isAvailable && !o.settled && o.expiry < block.timestamp, "not expired"); _;
    }
}
