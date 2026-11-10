// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title PitonTimelock
/// @notice OpenZeppelin's TimelockController, deployed unchanged. Make it the OptionPool owner (see
///         scripts/setupGovernance.js) so every parameter change is public `delay` seconds before it can
///         take effect, giving LPs time to exit. The multisig is proposer + executor; the guardian key
///         on the pool can still pause instantly.
contract PitonTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0)) {}
}
