// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MockERC20v2.sol";

contract MockOracle {
    int256  private _answer;
    bool    private _stale;
    uint256 private _age;     // seconds since the last update (0 = fresh)

    constructor(int256 price) {
        _answer    = price * 1e8;
    }

    function setPrice(int256 price) external { _answer = price * 1e8; }
    function setStale() external { _stale = true; }
    function setAge(uint256 secs) external { _age = secs; }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 t = _stale ? block.timestamp - 10801 : block.timestamp - _age;
        return (1, _answer, t, t, 1);
    }

    function decimals() external pure returns (uint8) { return 8; }
}

contract MockTrove {
    mapping(address => uint256) public status;
    mapping(address => uint256) public coll;
    mapping(address => uint256) public debt;

    function setTrove(address u, uint256 s, uint256 c, uint256 d) external {
        status[u] = s; coll[u] = c; debt[u] = d;
    }

    function getTroveStatus(address u) external view returns (uint256) { return status[u]; }
    function getTroveColl(address u)   external view returns (uint256) { return coll[u]; }
    function getTroveDebt(address u)   external view returns (uint256) { return debt[u]; }
}

contract MockBorrowerOps {
    event TrovePulled(address borrower, uint256 amount, address recipient);

    IERC20 public musd;
    uint256 public deliverBps = 10000; // test knob: deliver less than requested

    function setMUSD(address _musd) external { musd = IERC20(_musd); }
    function setDeliverBps(uint256 bps) external { deliverBps = bps; }

    /// @dev Mirrors BorrowerOperationsSignatures.withdrawMUSDWithSignature: borrows
    ///      `_amount` MUSD against `_borrower`'s Trove and sends it to `_recipient`.
    ///      Requires this mock to be pre-funded with MUSD in tests.
    function withdrawMUSDWithSignature(
        uint256 _amount, address, address,
        address _borrower, address _recipient,
        bytes calldata, uint256
    ) external {
        emit TrovePulled(_borrower, _amount, _recipient);
        if (address(musd) != address(0) && _amount > 0) {
            require(musd.transfer(_recipient, _amount * deliverBps / 10000), "mock transfer failed");
        }
    }
}

/// @dev Stand-in for Mezo's MUSDSavingsRate (sMUSD), following its verified interface and the behaviour seen on
///      testnet: deposit is 1:1, withdraw(amount) returns the principal and pays any accrued yield in the same
///      call, claimYield pays accrued yield only. Test knobs: accrue yield, break the vault, short-pay withdrawals.
contract MockSavings {
    MockERC20v2 public musd;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public claimableYield;
    bool public broken;      // every call reverts
    bool public shortPay;    // withdraw returns 1 wei less than asked

    constructor(MockERC20v2 _musd) { musd = _musd; }

    function setBroken(bool b) external { broken = b; }
    function setShortPay(bool b) external { shortPay = b; }
    /// Give `user` `amount` of claimable yield (minted, as Mezo funds yield from protocol fees).
    function accrue(address user, uint256 amount) external { musd.mint(address(this), amount); claimableYield[user] += amount; }

    function deposit(uint256 amount) external {
        require(!broken, "savings broken");
        musd.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
    }

    function withdraw(uint256 amount) external {
        require(!broken, "savings broken");
        balanceOf[msg.sender] -= amount;
        uint256 y = claimableYield[msg.sender];
        claimableYield[msg.sender] = 0;
        musd.transfer(msg.sender, amount + y - (shortPay ? 1 : 0));
    }

    function claimYield() external {
        require(!broken, "savings broken");
        uint256 y = claimableYield[msg.sender];
        claimableYield[msg.sender] = 0;
        musd.transfer(msg.sender, y);
    }
}
