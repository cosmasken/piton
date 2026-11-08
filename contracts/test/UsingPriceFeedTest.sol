//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "../safeMath/SafeMath.sol";

/**
 * @dev Test-only variant of UsingPriceFeed that accepts an injected oracle
 * address so unit tests can supply a MockSkipOracle.
 */
interface ISkipOracleT {
    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    );
    function decimals() external view returns (uint8);
}

contract UsingPriceFeedTest {
    using SafeMath for uint256;

    address public immutable SKIP_ORACLE;
    uint256 public constant PRICE_STALENESS_LIMIT = 7200;

    constructor(address oracle) public { SKIP_ORACLE = oracle; }

    /** @notice Returns BTC/USD price scaled to 10^18. */
    function getMarketValue() public view returns (uint256) {
        ISkipOracleT oracle = ISkipOracleT(SKIP_ORACLE);
        (, int256 answer, , uint256 updatedAt,) = oracle.latestRoundData();
        require(answer > 0, "Invalid price");
        require(block.timestamp.sub(updatedAt) <= PRICE_STALENESS_LIMIT, "Stale price");
        uint8 dec = oracle.decimals();
        return uint256(answer).mul(10**18).div(10**uint256(dec));
    }
}
