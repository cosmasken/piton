// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import "./vendor/derive/libraries/BlackScholes.sol";

/// @dev Test-only wrapper around Derive (Lyra) v1's Black-Scholes, the reference for differential tests.
contract DeriveBSWrapper {
    function prices(uint timeSec, uint vol, uint spot, uint strike, int rate) external pure returns (uint call, uint put) {
        return BlackScholes.optionPrices(BlackScholes.BlackScholesInputs(timeSec, vol, spot, strike, rate));
    }
}
