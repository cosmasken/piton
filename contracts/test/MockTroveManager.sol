// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

contract MockTroveManager {
    mapping(address => uint256) public coll;
    mapping(address => uint256) public debt;
    mapping(address => uint256) public status;

    function setTrove(address user, uint256 _coll, uint256 _debt, uint256 _status) external {
        coll[user] = _coll;
        debt[user] = _debt;
        status[user] = _status;
    }

    function getTroveColl(address borrower) external view returns (uint256) {
        return coll[borrower];
    }

    function getTroveDebt(address borrower) external view returns (uint256) {
        return debt[borrower];
    }

    function getTroveStatus(address borrower) external view returns (uint256) {
        return status[borrower];
    }

    // ICR = coll * price / debt (all 1e18), returns max if debt == 0.
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256) {
        uint256 d = debt[borrower];
        if (d == 0) return 2**256 - 1;
        return (coll[borrower] * price) / d;
    }
}

