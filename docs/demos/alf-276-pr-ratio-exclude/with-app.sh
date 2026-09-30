#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase mock the E2E suite uses, with GitHub
# stubbed at the network boundary (github-stub.mjs), run measure.mjs against it, and tear
# everything down again.
#
#   docs/demos/alf-276-pr-ratio-exclude/with-app.sh
#
# Ports are the demo's own (mock 54351, app 3031), never the E2E suite's (54331, 3000).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../../frontend"

export MOCK_SUPABASE_PORT=54351
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54351
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export INGEST_API_KEY=demo-ingest-key
export APP_URL=http://localhost:3031 MOCK_URL=http://localhost:54351
# A token that is never sent anywhere real, and the author allowlist that switches Other on.
export GITHUB_TOKEN=ghp_demo_not_a_real_token
export PR_RATIO_AUTHORS=ac3charland
GITHUB_STUB_LOG="$(mktemp)"
export GITHUB_STUB_LOG

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port on every run, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1
# The routes cache GitHub answers in Next's data cache; a hit from an earlier run would skip the
# stub and leave its query log short.
rm -rf .next/cache/fetch-cache

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK=$!
NODE_OPTIONS="--import $HERE/github-stub.mjs" npm run start -- -p 3031 >/dev/null 2>&1 &
APP=$!
# `npm run start` spawns next-server as a GRANDchild (npm → sh → next-server), so a one-level
# `pkill -P` misses it and it outlives this script holding the port: kill the whole tree.
kill_tree() {
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  kill_tree "$APP"
  kill_tree "$MOCK"
  rm -f "$GITHUB_STUB_LOG"
}
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

node "$HERE/measure.mjs"
