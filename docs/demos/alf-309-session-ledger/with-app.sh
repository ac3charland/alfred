#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase the E2E suite uses, then drive the two
# session-ledger routes: read the ledger inputs, check the auth, and push a whole backfill through
# the CLI over a row a recording hook already wrote.
#
#   docs/demos/alf-309-session-ledger/with-app.sh
#
# Ports are the demo's own (mock 54335, app 3015), never the E2E suite's (54331, 3000). The keys
# are demo values the mock deployment is configured with, not credentials.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../../.."
cd "$ROOT/frontend"

export MOCK_SUPABASE_PORT=54335
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54335
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export INGEST_API_KEY=demo-ingest-key
export LEDGER_API_KEY=demo-ledger-key
APP=http://localhost:3015
MOCK=http://localhost:54335

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port on every run, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK_PID=$!
npm run start -- -p 3015 >/dev/null 2>&1 &
APP_PID=$!
# `npm run start` spawns next-server as a GRANDchild, so kill the whole tree.
kill_tree() {
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() { kill_tree "$APP_PID"; kill_tree "$MOCK_PID"; }
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
wait_for "the mock backend" curl -sf "$MOCK/__mock__/health"
wait_for "the app" curl -s -o /dev/null "$APP/login"

# The project, one epic, and one story whose ticket notes the prompt replay needs.
curl -sf -X POST "$MOCK/__mock__/seed" -H 'Content-Type: application/json' --data-binary @- >/dev/null <<'JSON'
{"projects":[{"id":"11111111-1111-4111-8111-111111111111","key":"ALF","name":"Alfred","repo_owner":"ac3charland","repo_name":"alfred"}],
 "epics":[{"id":"44444444-4444-4444-8444-444444444444","project_id":"11111111-1111-4111-8111-111111111111","name":"Fixture epic","ref_number":4,"ref":"ALF-4","spec_path":"docs/specs/epics/ALF-4.html"}],
 "items":[{"id":"aaaaaaaa-0000-4000-8000-000000000009","title":"Give feedback when the button is pressed","item_type":"code","notes":"Invented notes: show a toast."}],
 "codeItems":[{"item_id":"aaaaaaaa-0000-4000-8000-000000000009","project_id":"11111111-1111-4111-8111-111111111111","epic_id":"44444444-4444-4444-8444-444444444444","ref_number":9,"ref":"ALF-9","factory_state":"done","spec_path":"docs/specs/ALF-9.html","spec_markdown":"<h1>a large spec snapshot</h1>"}]}
JSON

LEDGER="Authorization: Bearer demo-ledger-key"
INPUTS="$APP/api/code/ledger-inputs"
SESSIONS="$APP/api/code/sessions"
status() { curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$@"; }

echo "== GET /api/code/ledger-inputs with the ledger key: stories carry notes, never the spec snapshot"
curl -s "$INPUTS?repo=ac3charland/alfred" -H "$LEDGER" |
  jq -c '{project: .project.key, stories: [.stories[] | {ref, notes, spec_path, has_spec_markdown: has("spec_markdown")}], epics: [.epics[].ref]}'

echo
echo "== who gets in"
printf 'ingest key (x-api-key) ........ '; status "$INPUTS?repo=ac3charland/alfred" -H 'x-api-key: demo-ingest-key'
printf 'ingest key (Bearer) ........... '; status "$INPUTS?repo=ac3charland/alfred" -H 'Authorization: Bearer demo-ingest-key'
printf 'no auth ....................... '; status "$INPUTS?repo=ac3charland/alfred"
printf 'ledger key, unknown repo ...... '; status "$INPUTS?repo=someone/else" -H "$LEDGER"
printf 'ledger key, malformed repo .... '; status "$INPUTS?repo=alfred" -H "$LEDGER"
printf 'ingest key on the write ....... '; status -X POST "$SESSIONS" -H 'Authorization: Bearer demo-ingest-key' -H 'Content-Type: application/json' --data '{"rows":[]}'
printf 'ledger key, empty batch ....... '; status -X POST "$SESSIONS" -H "$LEDGER" -H 'Content-Type: application/json' --data '{"rows":[]}'
printf 'ledger key, 101 rows .......... '
head -n 1 "$ROOT/tools/session-ledger/fixtures/golden-rows.ndjson" |
  jq -c '[range(101) as $i | . + {session_id: "session_\($i)"}] | {rows: .}' |
  status -X POST "$SESSIONS" -H "$LEDGER" -H 'Content-Type: application/json' --data-binary @-

echo
echo "== mid-session, a recording hook wrote session_01ImplSpec: its exact prompt, cost 1.00, PR still open"
jq -c 'select(.session_id == "session_01ImplSpec") | . + {prompt: "the prompt exactly as the owner sent it", prompt_source: "recorded", cost_usd: 1, pr_state: "open"} | {rows: [.]}' \
  "$ROOT/tools/session-ledger/fixtures/golden-rows.ndjson" |
  curl -s -X POST "$SESSIONS" -H "$LEDGER" -H 'Content-Type: application/json' --data-binary @-
echo

echo
echo "== the backfill pushes all 20 fixture rows through the CLI (LEDGER_API_KEY and ALFRED_BASE_URL set)"
cd "$ROOT"
ALFRED_BASE_URL="$APP" npm run -s ledger -w tools/session-ledger -- push tools/session-ledger/fixtures/golden-rows.ndjson --report | tail -n 1

echo
echo "== the stored row kept the recorded prompt; cost and PR state refreshed from the backfill"
curl -s "$MOCK/__mock__/state" |
  jq -c '.codeSessions[] | select(.session_id == "session_01ImplSpec") | {prompt, prompt_source, cost_usd, pr_state}'
