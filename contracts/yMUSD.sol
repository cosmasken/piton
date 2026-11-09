// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title yMUSD — Piton liquidity pool LP token
/// @notice Yield-bearing MUSD. Minted on deposit, burned on withdrawal.
///         Only the OptionPool contract can mint or burn.
contract yMUSD is ERC20, Ownable {
    address public pool;

    modifier onlyPool() {
        require(msg.sender == pool, "yMUSD: caller is not pool");
        _;
    }

    constructor() ERC20("Piton Yield MUSD", "yMUSD") Ownable(msg.sender) {}

    function setPool(address _pool) external onlyOwner {
        require(_pool != address(0), "zero address");
        pool = _pool;
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }
}
