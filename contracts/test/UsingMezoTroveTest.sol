//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.7.0;
pragma experimental ABIEncoderV2;

import "../safeMath/SafeMath.sol";

/**
 * @dev Test-only UsingMezoTrove that accepts injected TroveManager and
 * BorrowerOperationsSignatures addresses instead of the hardcoded matsnet ones.
 */
interface ITroveManagerT {
    function getTroveStatus(address) external view returns (uint256);
    function getTroveColl(address)   external view returns (uint256);
    function getTroveDebt(address)   external view returns (uint256);
}

interface IBorrowerOpsSigsT {
    function adjustTroveWithSignature(
        uint256, uint256, bool, address, address,
        address, address, bytes calldata, uint256
    ) external;
}

contract UsingMezoTroveTest {
    using SafeMath for uint256;

    address public immutable TROVE_MANAGER;
    address public immutable BORROWER_OPS_SIGS;

    constructor(address _tm, address _bos) public {
        TROVE_MANAGER     = _tm;
        BORROWER_OPS_SIGS = _bos;
    }

    function troveEquityMUSD(address owner, uint256 btcPrice) public view returns (uint256) {
        ITroveManagerT tm = ITroveManagerT(TROVE_MANAGER);
        if (tm.getTroveStatus(owner) != 1) return 0;
        uint256 collValue = tm.getTroveColl(owner).mul(btcPrice).div(10**18);
        uint256 debt      = tm.getTroveDebt(owner);
        if (collValue <= debt) return 0;
        return collValue.sub(debt);
    }

    function troveCoversMargin(address owner, uint256 required, uint256 btcPrice) public view returns (bool) {
        return troveEquityMUSD(owner, btcPrice) >= required;
    }

    function _pullFromTrove(address borrower, uint256 amount, bytes memory sig, uint256 deadline) internal {
        IBorrowerOpsSigsT(BORROWER_OPS_SIGS).adjustTroveWithSignature(
            0, amount, true, address(0), address(0),
            borrower, address(this), sig, deadline
        );
    }
}
