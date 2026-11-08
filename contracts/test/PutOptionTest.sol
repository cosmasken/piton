//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "../musdContracts/UsingMUSD.sol";
import "./UsingPriceFeedTest.sol";
import "./UsingMezoTroveTest.sol";
import "../safeMath/SafeMath.sol";

contract PutOptionTest is UsingMUSD, UsingPriceFeedTest, UsingMezoTroveTest {
    using SafeMath for uint256;

    uint256 public uniqueId;
    mapping(address => uint256) public pendingBTC;
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

    function createNewOptionLong(uint256 _type, uint256 _sp, uint256 _cost, uint256 _qty) external {
        require(musdInstance.transferFrom(msg.sender, address(this), _cost), "premium escrow");
        idToOption[uniqueId] = Option(true, false, msg.sender, address(0), POSITION.SHORT,
            uniqueId, _type, 0, _sp, _cost, _qty, block.timestamp + 2 days, "", 0);
        addressToOptions[msg.sender].push(uniqueId++);
    }

    function createNewOptionShort(
        uint256 _sp, uint256 _cost, uint256 _qty,
        uint256 _margin, bytes calldata _sig, uint256 _dl
    ) external {
        uint256 mt = (_sig.length > 0) ? 2 : 1;
        if (mt == 1) {
            require(_margin >= _sp, "margin low");
            require(musdInstance.transferFrom(msg.sender, address(this), _margin), "margin escrow");
        } else {
            require(troveCoversMargin(msg.sender, _sp, getMarketValue()), "trove low");
            require(_dl > block.timestamp, "bad deadline");
        }
        idToOption[uniqueId] = Option(true, false, address(0), msg.sender, POSITION.LONG,
            uniqueId, mt, _margin, _sp, _cost, _qty, block.timestamp + 2 days, _sig, _dl);
        addressToOptions[msg.sender].push(uniqueId++);
    }

    function buyToOpen(uint256 _id, uint256 _type) external isAvailable(idToOption[_id]) {
        Option storage o = idToOption[_id];
        require(o.openPosition == POSITION.LONG && msg.sender != o.partyS, "bad fill");
        if (o.settlementType == 2)
            require(troveCoversMargin(o.partyS, o.strikePrice, getMarketValue()), "trove low at fill");
        require(musdInstance.transferFrom(msg.sender, address(this), o.cost), "premium");
        musdInstance.transfer(o.partyS, o.cost);
        o.isAvailable = false; o.partyL = msg.sender;
        if (o.settlementType != 2) o.settlementType = _type;
        addressToOptions[msg.sender].push(_id);
    }

    function sellToOpen(uint256 _id, uint256 _margin, bytes calldata _sig, uint256 _dl)
        external isAvailable(idToOption[_id])
    {
        Option storage o = idToOption[_id];
        require(o.openPosition == POSITION.SHORT && msg.sender != o.partyL, "bad fill");
        uint256 mt = (_sig.length > 0) ? 2 : 1;
        if (mt == 1) {
            require(_margin >= o.strikePrice, "margin low");
            require(musdInstance.transferFrom(msg.sender, address(this), _margin), "margin escrow");
        } else {
            require(troveCoversMargin(msg.sender, o.strikePrice, getMarketValue()), "trove low");
            require(_dl > block.timestamp, "bad deadline");
        }
        musdInstance.transfer(msg.sender, o.cost);
        o.initialSellerMargin = _margin;
        // Preserve the long's delivery type (0=BTC, 1=MUSD); only override to 2 for Trove margin
        if (mt == 2) o.settlementType = 2;
        o.isAvailable = false; o.partyS = msg.sender;
        o.troveSignature = _sig; o.troveDeadline = _dl;
        addressToOptions[msg.sender].push(_id);
    }

    function settleOption(uint256 _id) external payable hasNotSettled(idToOption[_id]) {
        Option storage o = idToOption[_id];
        uint256 mv = o.quantity.mul(getMarketValue()).div(10**18);
        require(o.strikePrice > mv, "OTM");
        require(msg.sender == o.partyL, "not long");

        if (o.settlementType == 0) {
            require(msg.value == o.quantity, "btc amount");
            pendingBTC[o.partyS] = pendingBTC[o.partyS].add(o.quantity);
            musdInstance.transfer(o.partyL, o.strikePrice);
        } else if (o.settlementType == 1) {
            uint256 profit = o.strikePrice.sub(mv);
            musdInstance.transfer(msg.sender, profit);
            musdInstance.transfer(o.partyS, o.initialSellerMargin.sub(profit));
        } else {
            ITroveManagerT tm = ITroveManagerT(TROVE_MANAGER);
            if (tm.getTroveStatus(o.partyS) != 1) {
                o.settled = true; return;
            }
            uint256 profit = o.strikePrice.sub(mv);
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
            if (o.settlementType == 1) musdInstance.transfer(msg.sender, o.initialSellerMargin);
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
        if (o.settlementType == 1) musdInstance.transfer(o.partyS, o.initialSellerMargin);
    }

    function withdrawBTC() external {
        uint256 a = pendingBTC[msg.sender];
        require(a > 0, "nothing");
        pendingBTC[msg.sender] = 0;
        address(uint160(msg.sender)).transfer(a);
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
