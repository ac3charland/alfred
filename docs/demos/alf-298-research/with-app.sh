#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase the E2E suite uses, run
# `delivery-contract.mjs` against it, and tear everything down again.
#
#   docs/demos/alf-298-research/with-app.sh
#
# The app runs with research configured: the three server-only research vars point its fire at the
# mock's stand-in Routine (`/__mock__/routine/fire`) and set the delivery key the script presents.
# Ports are the demo's own (mock 54333, app 3012), never the E2E suite's (54331, 3000).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../../frontend"

export MOCK_SUPABASE_PORT=54333
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54333
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export INGEST_API_KEY=demo-ingest-key
export RESEARCH_ROUTINE_FIRE_URL=http://localhost:54333/__mock__/routine/fire
export RESEARCH_ROUTINE_FIRE_TOKEN=demo-routine-token
export RESEARCH_DELIVERY_KEY=demo-research-key
export APP_URL=http://localhost:3012 MOCK_URL=http://localhost:54333

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port on every run, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK=$!
npm run start -- -p 3012 >/dev/null 2>&1 &
APP=$!
# `npm run start` spawns next-server as a GRANDchild (npm → sh → next-server): kill the whole tree.
kill_tree() {
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() { kill_tree "$APP"; kill_tree "$MOCK"; }
trap cleanup EXIT
# Bounded: a server that never comes up fails the demo in two minutes instead of hanging it.
wait_for() {
  local name="$1"
  shift
  for _ in $(seq 120); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "with-app.sh: $name did not come up within 120s" >&2
  exit 1
}
wait_for "the mock backend" curl -sf "$MOCK_URL/__mock__/health"
wait_for "the app" curl -s -o /dev/null "$APP_URL/login"

node "$HERE/delivery-contract.mjs"
