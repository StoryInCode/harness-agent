#!/usr/bin/env bash
# FORK-LOCAL: axiom checker for `R-claims-verified` (see FORK.md).
# Delegates to scripts/check-pieces.ts, which validates through the same parser
# the development loop uses at runtime, so the axiom and the runtime cannot drift.
# With no argument it checks the whole corpus; "$FILE" checks one piece.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx tsx scripts/check-pieces.ts claims "$@"
