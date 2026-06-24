#!/usr/bin/env bash
# Demonstrate the two DB guardrails catching the real-Postgres bug class the JS mock can't:
#   1. migration-lint (static, check:fast) — its sequence-grant rule.
#   2. the database integration suite (real Postgres, check:slow) — src/run.ts.
# Each is shown GREEN on the committed migrations and RED on a fixture with 0008's grant
# removed (a temp copy — the repo's migrations are never touched). Output is deterministic
# (fresh cluster, fixed seed) so `npm run demo -- verify` stays green where Postgres exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# A migration set with the 0008 USAGE grant removed — drives the RED cases without repo mutation.
TMP="$(mktemp -d)"
FIX="$TMP/migrations"
cp -r database/migrations "$FIX"
rm -f "$FIX/0008_grant_priority_seq.sql"
trap 'rm -rf "$TMP"' EXIT

echo "== migration-lint — committed migrations (GREEN) =="
npm run --silent lint:migrations -w tools/migration-lint 2>/dev/null | grep -E 'migration-lint:'

echo
echo "== migration-lint — 0008 grant missing (RED) =="
{ npm run --silent lint:migrations -w tools/migration-lint -- "$FIX" 2>/dev/null || true; } \
  | grep -oE 'sequence [a-z_]+ \(created in [^)]+\) is missing USAGE grants for: [^.]+\.|migration-lint: [0-9]+ error'

echo
echo "== integration suite — committed migrations (GREEN) =="
npm run --silent test:integration -w database 2>/dev/null | grep -E '✓|✗|↳|db-integration:'

echo
echo "== integration suite — 0008 grant missing (RED) =="
{ ALFRED_MIGRATIONS_DIR="$FIX" npm run --silent test:integration -w database 2>/dev/null || true; } \
  | grep -E '✓|✗|↳|db-integration:'
