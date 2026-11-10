#!/usr/bin/env bash
# Run Slither and Aderyn on Piton's own contracts (OptionPool, yMUSD).
#
# Requires: slither-analyzer 0.11.6 (uv tool install slither-analyzer==0.11.6)
#           aderyn 0.6.8         (npm install -g @cyfrin/aderyn@0.6.8)
# Mezo's fetched contracts (contracts/mezo) are out of scope and break Slither's parser, so they
# are moved aside for the run and always restored.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-audit/out}"
mkdir -p "$OUT"
HOLD="$(mktemp -d)"
restore() {
  [ -d "$HOLD/mezo" ] && mv "$HOLD/mezo" contracts/mezo
  [ -f "$HOLD/MezoProxy.sol" ] && mv "$HOLD/MezoProxy.sol" contracts/test/MezoProxy.sol
  rmdir "$HOLD" 2>/dev/null || true
  npx hardhat compile >/dev/null 2>&1 || true
}
trap restore EXIT
[ -d contracts/mezo ] && mv contracts/mezo "$HOLD/mezo"
[ -f contracts/test/MezoProxy.sol ] && mv contracts/test/MezoProxy.sol "$HOLD/MezoProxy.sol"
npx hardhat clean >/dev/null 2>&1

slither . --filter-paths "contracts/test|node_modules" --exclude-dependencies \
  --json "$OUT/slither.json" > "$OUT/slither.txt" 2>&1 || true
aderyn . --path-includes contracts/OptionPool.sol,contracts/yMUSD.sol -o "$OUT/aderyn.md" > /dev/null 2>&1

python3 - "$OUT/slither.json" <<'PY'
import json, sys
from collections import Counter
d = json.load(open(sys.argv[1]))
c = Counter((x["impact"], x["check"]) for x in d["results"]["detectors"])
print(f"slither: {sum(c.values())} results")
for (impact, check), n in sorted(c.items()): print(f"  {impact:<14} {check:<26} {n}")
PY
echo "aderyn:"; grep -E "^## [HL]-" "$OUT/aderyn.md" | sed 's/^/  /'
echo "reports in $OUT (triage: audit/STATIC_ANALYSIS.md)"
