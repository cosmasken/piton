// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

/**
 * @dev Mock BorrowerOperationsSignatures for tests.
 * adjustTroveWithSignature mints `_debtChange` MUSD to `_recipient`
 * (simulating the Trove borrowing more MUSD).
 */
interface IMintable {
    function mint(address to, uint256 amount) external;
}

contract MockBorrowerOpsSigs {
    address public musd;

    constructor(address _musd) public { musd = _musd; }

    function getNonce(address) external pure returns (uint256) { return 0; }

    function adjustTroveWithSignature(
        uint256,          // collWithdrawal
        uint256 _debtChange,
        bool    _isDebtIncrease,
        address,          // upperHint
        address,          // lowerHint
        address,          // borrower
        address _recipient,
        bytes   calldata, // signature (ignored in mock)
        uint256           // deadline
    ) external {
        require(_isDebtIncrease, "mock: only debt increase");
        IMintable(musd).mint(_recipient, _debtChange);
    }
}
