#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase + mock GitHub the E2E suite uses, run one
# section of `send-contract.mjs` against it, and tear everything down again.
#
#   docs/demos/alf-261-day-2-wiki/with-app.sh <reader|inbox|secrets>
#
# The app runs as the PERSONAL deployment: the wiki writer's three server-only env vars point it
# at the mock's Git Data API emulation (`/__mock__/github/…`, bearer `mock_wiki_token`). Ports are
# the demo's own (mock 54332, app 3011), never the E2E suite's (54331, 3000).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../../frontend"

export MOCK_SUPABASE_PORT=54332
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54332
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export INGEST_API_KEY=demo-ingest-key
export WIKI_GITHUB_TOKEN=mock_wiki_token
export WIKI_REPO=ac3charland/knowledge
export WIKI_GITHUB_API_URL=http://localhost:54332/__mock__/github
export APP_URL=http://localhost:3011 MOCK_URL=http://localhost:54332

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port on every run, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK=$!
npm run start -- -p 3011 >/dev/null 2>&1 &
APP=$!
# `npm run start` spawns next-server as a child: kill it too, or it outlives this script.
cleanup() { pkill -P "$APP" 2>/dev/null || true; kill "$APP" "$MOCK" 2>/dev/null || true; }
trap cleanup EXIT
until curl -sf "$MOCK_URL/__mock__/health" >/dev/null 2>&1; do sleep 0.2; done
until curl -s -o /dev/null "$APP_URL/login" 2>/dev/null; do sleep 0.5; done

node "$HERE/send-contract.mjs" "$1"
