// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockOracle {
    int256  private _answer;
    uint256 private _updatedAt;

    constructor(int256 price) {
        _answer    = price * 1e8;
        _updatedAt = block.timestamp;
    }

    function setPrice(int256 price) external { _answer = price * 1e8; }
    function setStale() external { _updatedAt = block.timestamp - 10801; }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, _answer, _updatedAt, _updatedAt, 1);
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

    function adjustTroveWithSignature(
        uint256, uint256 _debtChange, bool,
        address, address, address _borrower, address _recipient,
        bytes calldata, uint256
    ) external {
        emit TrovePulled(_borrower, _debtChange, _recipient);
    }
}
