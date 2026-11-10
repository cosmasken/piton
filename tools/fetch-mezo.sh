#!/usr/bin/env bash
# Fetch Mezo's MUSD protocol contracts (GPL-3.0, mezo-org/musd) into contracts/mezo for integration
# tests on the Hardhat network. They are NOT vendored in this repo (gitignored) because of their license.
set -euo pipefail
COMMIT="da7888a10949c8a5d3f884454cec8978cfa87e48"
DEST="$(cd "$(dirname "$0")/.." && pwd)/contracts/mezo"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet https://github.com/mezo-org/musd.git "$TMP/musd"
git -C "$TMP/musd" checkout --quiet "$COMMIT"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$TMP/musd/solidity/contracts/." "$DEST/"
# not needed for integration tests (fuzzing / debugging / upgrade-test helpers)
rm -rf "$DEST/echidna" "$DEST/debugging" "$DEST/tests/upgrades" "$DEST/tests/BTCFeeRecipientMock.sol" "$DEST/tests/MUSDSavingsRateMock.sol"

# @openzeppelin/contracts-upgradeable >= 5.5 no longer ships ReentrancyGuardUpgradeable, which PCV.sol
# imports. Use a minimal local shim instead of downgrading OpenZeppelin for the whole project.
mkdir -p "$DEST/shims"
cat > "$DEST/shims/ReentrancyGuardUpgradeable.sol" <<'SOL'
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @dev Test-only stand-in for OZ's removed ReentrancyGuardUpgradeable (same API).
abstract contract ReentrancyGuardUpgradeable is Initializable {
    uint256 private _status; // 0 = uninitialised (treated as not entered), 1 = not entered, 2 = entered

    error ReentrancyGuardReentrantCall();

    function __ReentrancyGuard_init() internal onlyInitializing {
        _status = 1;
    }

    modifier nonReentrant() {
        if (_status == 2) revert ReentrancyGuardReentrantCall();
        _status = 2;
        _;
        _status = 1;
    }
}
SOL
sed -i 's#@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol#./shims/ReentrancyGuardUpgradeable.sol#' "$DEST/PCV.sol"

echo "Mezo contracts @ $COMMIT -> $DEST"
