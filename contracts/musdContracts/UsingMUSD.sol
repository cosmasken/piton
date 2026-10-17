//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

import './IERC20.sol';

/**
 * @notice Base contract for interacting with MUSD, Mezo's Bitcoin-backed stablecoin.
 */
contract UsingMUSD {
    IERC20 public musdInstance;

    constructor(address _musdAddress) public {
        musdInstance = IERC20(_musdAddress);
    }
}
