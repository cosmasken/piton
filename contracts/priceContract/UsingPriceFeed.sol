//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

import "../safeMath/SafeMath.sol";

/**
 * @notice Chainlink-compatible interface for the Skip oracle on Mezo.
 * Provides BTC/USD price via latestRoundData().
 * Contract: 0x7b7c000000000000000000000000000000000015 (matsnet + mainnet)
 */
interface ISkipOracle {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

contract UsingPriceFeed {
    using SafeMath for uint256;

    // Skip oracle — same address on matsnet and mainnet
    address public constant SKIP_ORACLE = 0x7b7c000000000000000000000000000000000015;

    // Reject prices older than 2 hours (7200 s). Mezo blocks are ~2 s so this
    // is very conservative; tighten to 300 s once oracle cadence is confirmed.
    uint256 public constant PRICE_STALENESS_LIMIT = 7200;

    /**
     * @notice Returns BTC/USD price scaled to 10^18.
     * Reverts if the oracle answer is non-positive or stale.
     */
    function getMarketValue() public view returns (uint256) {
        ISkipOracle oracle = ISkipOracle(SKIP_ORACLE);
        (, int256 answer, , uint256 updatedAt,) = oracle.latestRoundData();
        require(answer > 0, "Invalid price");
        require(block.timestamp.sub(updatedAt) <= PRICE_STALENESS_LIMIT, "Stale price");
        uint8 dec = oracle.decimals();
        return uint256(answer).mul(10**18).div(10**uint256(dec));
    }

    /**
     * @notice Returns current BTC/USD price twice (past, now).
     * Skip oracle does not expose historical data on-chain.
     */
    function getBtcRange() external view returns (uint256 past, uint256 now_) {
        uint256 current = getMarketValue();
        return (current, current);
    }
}
