// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../OptionPool.sol";

/// @dev Test-only: lets tests force pool accounting into states that are hard to reach naturally
///      (e.g. a total loss with yMUSD still outstanding).
contract OptionPoolHarness is OptionPool {
    constructor(address _musd, address _ymusd, address _oracle, address _troveManager, address _borrowerOps)
        OptionPool(_musd, _ymusd, _oracle, _troveManager, _borrowerOps) {}

    function forceTotalAssets(uint256 v) external { totalAssets = v; }
}
