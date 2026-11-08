//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;

import "../safeMath/SafeMath.sol";

/**
 * @notice Interfaces for Mezo's TroveManager and BorrowerOperationsSignatures.
 * Addresses are the same on matsnet (31611).
 */
interface ITroveManager {
    /// @dev Returns 1 when the trove is active.
    function getTroveStatus(address borrower) external view returns (uint256);
    function getTroveColl(address borrower)   external view returns (uint256);
    function getTroveDebt(address borrower)   external view returns (uint256);
}

interface IBorrowerOperationsSignatures {
    function getNonce(address user) external view returns (uint256);

    /// @dev Pulls `_debtChange` MUSD from the trove into `_recipient` using a
    ///      pre-signed EIP-712 payload.  The option contract is `_recipient`.
    function adjustTroveWithSignature(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool    _isDebtIncrease,
        address _upperHint,
        address _lowerHint,
        address _borrower,
        address _recipient,
        bytes   calldata _signature,
        uint256 _deadline
    ) external;
}

/**
 * @title UsingMezoTrove
 * @notice Shared helpers for Trove-backed (type 2) option margin.
 *
 * Design:
 *   - No tokens move at order creation or fill.  The short's Trove equity is
 *     verified read-only at those points.
 *   - At settlement the contract calls adjustTroveWithSignature with a
 *     pre-signed payload the short provided at fill time, pulling exactly
 *     `payout` MUSD from their Trove into this contract, then forwarding it
 *     to the long.
 *   - At expiry (refundExpired) no tokens need to move — the lien is simply
 *     released by marking the option settled.
 *   - If the Trove is liquidated before settlement (status != 1) the option
 *     is treated as expired: long reclaims premium, short gets nothing extra.
 */
contract UsingMezoTrove {
    using SafeMath for uint256;

    // Mezo matsnet addresses (same on mainnet per trovepilot deploy.ts)
    address public constant TROVE_MANAGER =
        0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address public constant BORROWER_OPS_SIGS =
        0xD757e3646AF370b15f32EB557F0F8380Df7D639e;

    // Minimum ICR a Trove must have to be accepted as margin (150 % = 1.5e18).
    // Mezo's MCR is 110 %; we require 150 % to give a safety buffer.
    uint256 public constant MIN_TROVE_ICR = 15e17;

    /**
     * @notice Returns the net MUSD equity of a Trove at the given BTC price.
     *         equity = coll * price - debt  (all 1e18)
     *         Returns 0 if the trove is not active or is underwater.
     */
    function troveEquityMUSD(address owner, uint256 btcPrice)
        public view returns (uint256)
    {
        ITroveManager tm = ITroveManager(TROVE_MANAGER);
        if (tm.getTroveStatus(owner) != 1) return 0;
        uint256 collValue = tm.getTroveColl(owner).mul(btcPrice).div(10**18);
        uint256 debt      = tm.getTroveDebt(owner);
        if (collValue <= debt) return 0;
        return collValue.sub(debt);
    }

    /**
     * @notice Returns true when the Trove equity covers `required` MUSD at
     *         the current oracle price.
     */
    function troveCoversMargin(address owner, uint256 required, uint256 btcPrice)
        public view returns (bool)
    {
        return troveEquityMUSD(owner, btcPrice) >= required;
    }

    /**
     * @notice Pulls `amount` MUSD from the short's Trove into this contract
     *         using their pre-signed EIP-712 payload.
     * @param borrower   Short party address (Trove owner).
     * @param amount     MUSD to withdraw from the Trove.
     * @param signature  Pre-signed adjustTroveWithSignature payload.
     * @param deadline   Signature deadline (unix timestamp).
     */
    function _pullFromTrove(
        address borrower,
        uint256 amount,
        bytes memory signature,
        uint256 deadline
    ) internal {
        IBorrowerOperationsSignatures(BORROWER_OPS_SIGS).adjustTroveWithSignature(
            0,           // collWithdrawal
            amount,      // debtChange (borrow more MUSD)
            true,        // isDebtIncrease
            address(0),  // upperHint — zero is valid for small books
            address(0),  // lowerHint
            borrower,
            address(this),
            signature,
            deadline
        );
    }
}
