//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

/**
 * @dev Mock Skip oracle for tests.
 * If `_stale` is true, updatedAt is set 3 hours in the past to trigger the
 * staleness check in UsingPriceFeed.
 */
contract MockSkipOracle {
    int256  private _answer;
    uint256 private _updatedAt;

    constructor(int256 price, bool stale) public {
        _answer    = price * 1e8; // 8 decimals like Chainlink
        _updatedAt = stale ? block.timestamp - 10801 : block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }

    function decimals() external pure returns (uint8) { return 8; }
}
