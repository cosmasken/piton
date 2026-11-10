// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockOracle {
    int256  private _answer;
    bool    private _stale;

    constructor(int256 price) {
        _answer    = price * 1e8;
    }

    function setPrice(int256 price) external { _answer = price * 1e8; }
    function setStale() external { _stale = true; }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 t = _stale ? block.timestamp - 10801 : block.timestamp;
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
