#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase + stand-in Instapaper the E2E suite uses,
# run the named sections of `send-contract.mjs` (route evidence) or `journey.mjs` (screenshots of
# the running app) against it in turn, each on a freshly reset mock, and tear everything down.
#
#   docs/demos/alf-289-further-reading/with-app.sh <reader|instapaper|no-folder|nothing-left|refused|journey|journey-unconfigured>...
#
# The four INSTAPAPER_* values are the E2E suite's fakes: they switch the Reader's sends on, and
# INSTAPAPER_API_URL points every signed call at the mock, which answers `folders/list` and
# `bookmarks/add` the way Instapaper does. `journey-unconfigured` restarts the app WITHOUT them,
# which is the deployment where the section is a plain list of links. Ports are this demo's own
# (mock 54334, app 3013), never the E2E suite's (54331, 3000) nor another demo's.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../../frontend"

export MOCK_SUPABASE_PORT=54334
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54334
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export INGEST_API_KEY=demo-ingest-key
export APP_URL=http://localhost:3013 MOCK_URL=http://localhost:54334
INSTAPAPER_ENV=(
  INSTAPAPER_CONSUMER_KEY=mock-consumer-key
  INSTAPAPER_CONSUMER_SECRET=mock-consumer-secret
  INSTAPAPER_ACCESS_TOKEN=mock-access-token
  INSTAPAPER_ACCESS_TOKEN_SECRET=mock-access-token-secret
  INSTAPAPER_API_URL=http://localhost:54334
)

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port on every run, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK=$!
APP=""
# `npm run start` spawns next-server as a GRANDchild (npm → sh → next-server), so a one-level
# `pkill -P` misses it and it outlives this script holding the port: kill the whole tree.
kill_tree() {
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() { [ -n "$APP" ] && kill_tree "$APP"; kill_tree "$MOCK"; }
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
# Start (or restart) the app, with or without the Instapaper credentials.
start_app() {
  if [ -n "$APP" ]; then
    kill_tree "$APP"
    APP=""
    for _ in $(seq 30); do curl -s -o /dev/null "$APP_URL/login" || break; sleep 1; done
  fi
  if [ "$1" = configured ]; then
    env "${INSTAPAPER_ENV[@]}" npm run start -- -p 3013 >/dev/null 2>&1 &
  else
    npm run start -- -p 3013 >/dev/null 2>&1 &
  fi
  APP=$!
  wait_for "the app" curl -s -o /dev/null "$APP_URL/login"
}

wait_for "the mock backend" curl -sf "$MOCK_URL/__mock__/health"
MODE=""
for section in "$@"; do
  if [ "$section" = journey-unconfigured ]; then
    [ "$MODE" = unconfigured ] || { start_app unconfigured; MODE=unconfigured; }
    node "$HERE/journey.mjs" unconfigured
  elif [ "$section" = journey ]; then
    [ "$MODE" = configured ] || { start_app configured; MODE=configured; }
    node "$HERE/journey.mjs" configured
  else
    [ "$MODE" = configured ] || { start_app configured; MODE=configured; }
    node "$HERE/send-contract.mjs" "$section"
  fi
done
