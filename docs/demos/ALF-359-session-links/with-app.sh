#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase mock the E2E suite uses, run
# `journey.mjs` against it (screenshots go to the directory given as $1), and tear it all down.
#
#   docs/demos/ALF-359-session-links/with-app.sh <screenshot-dir>
#
# Ports are the demo's own (mock 54333, app 3012), never the E2E suite's (54331, 3000). The keys
# are the E2E harness's placeholders, not credentials.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SHOTS="$(mkdir -p "$1" && cd "$1" && pwd)"
cd "$HERE/../../../frontend"

export MOCK_SUPABASE_PORT=54333
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54333
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export LEDGER_API_KEY=mock_ledger_key
# The mock's one login: a throwaway password minted per run, which both it and journey.mjs read.
export E2E_USER_EMAIL=demo@alfred.test E2E_USER_PASSWORD="$(node -e 'console.log(crypto.randomUUID())')"
export APP_URL=http://localhost:3012 MOCK_URL=http://localhost:54333

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK=$!
npm run start -- -p 3012 >/dev/null 2>&1 &
APP=$!
# `npm run start` spawns next-server as a grandchild: kill the whole tree.
kill_tree() {
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() { kill_tree "$APP"; kill_tree "$MOCK"; }
trap cleanup EXIT
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

TZ=UTC node "$HERE/journey.mjs" "$SHOTS"
