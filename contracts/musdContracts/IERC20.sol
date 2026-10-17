//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

/**
 * @notice Standard ERC20 interface used to interact with MUSD on Mezo.
 * MUSD mainnet:  0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 (chainId 31612)
 * MUSD matsnet:  0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 (chainId 31611)
 */
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function totalSupply() external view returns (uint256);
    function balanceOf(address who) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
