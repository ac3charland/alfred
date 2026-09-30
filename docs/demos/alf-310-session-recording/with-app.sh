#!/usr/bin/env bash
# Boot the real Next app against the in-memory Supabase the E2E suite uses, then run the recording
# hook for real against it: both of a session's writes land through POST /api/code/sessions/record,
# the route refuses the ingest key and a sent cost, and a backfill re-run keeps what was recorded.
#
#   docs/demos/alf-310-session-recording/with-app.sh
#
# Ports are the demo's own (mock 54337, app 3017), never the E2E suite's (54331, 3000). The keys
# are demo values the mock deployment is configured with, not credentials.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../../.."
cd "$ROOT/frontend"

export MOCK_SUPABASE_PORT=54337
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54337
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mock
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_mock
export INGEST_API_KEY=demo-ingest-key
export LEDGER_API_KEY=demo-ledger-key
APP=http://localhost:3017
MOCK=http://localhost:54337

# Unconditionally: Next inlines NEXT_PUBLIC_* at build time, and the E2E harness rebuilds .next
# against its own port on every run, so a cached build would talk to the wrong mock.
npm run build >/dev/null 2>&1

node scripts/mock-supabase.mjs >/dev/null 2>&1 &
MOCK_PID=$!
npm run start -- -p 3017 >/dev/null 2>&1 &
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

curl -sf -X POST "$MOCK/__mock__/seed" -H 'Content-Type: application/json' --data '{}' >/dev/null

RECORD="$APP/api/code/sessions/record"
STOP="$ROOT/tools/session-ledger/src/hook/__fixtures__/recorded-row.json"
status() { curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$@"; }

echo "== the hook, run as Claude Code runs it, posting to the app with the ledger key"
ALFRED_BASE_URL="$APP" LEDGER_API_KEY=demo-ledger-key "$HERE/hook.sh" live

echo
echo "== the row both writes left"
curl -s "$MOCK/__mock__/state" | jq -c '.codeSessions[] | {session_id, prompt_source, ref, base_sha, output_tokens, subagent_count, skills: (.skills | length), cost_usd, warnings}'

echo
echo "== who gets in, and what the route refuses"
printf 'ingest key .................... '; status -X POST "$RECORD" -H 'Authorization: Bearer demo-ingest-key' -H 'Content-Type: application/json' --data-binary @"$STOP"
printf 'no auth ....................... '; status -X POST "$RECORD" -H 'Content-Type: application/json' --data-binary @"$STOP"
printf 'ledger key, a sent cost ....... '
jq -c '. + {cost_usd: 1.5}' "$STOP" | status -X POST "$RECORD" -H 'Authorization: Bearer demo-ledger-key' -H 'Content-Type: application/json' --data-binary @-
printf 'ledger key, a backfill code ... '
jq -c '. + {warnings: ["no_pr"]}' "$STOP" | status -X POST "$RECORD" -H 'Authorization: Bearer demo-ledger-key' -H 'Content-Type: application/json' --data-binary @-

echo
echo "== a backfill re-run for the same session: PR fields fill in, the recorded columns stay"
jq -c '{rows: [{session_id, repo, title: "ALF-310 session", session_created_at: "2026-10-03T09:12:39Z",
  status: "SESSION_STATUS_BUCKET_COMPLETED", configured_model: "claude-opus-5-5", model: "claude-opus-5-5",
  served_model: "claude-opus-5-5", effort_level: "high", cost_usd: 12.25, input_tokens: 1, output_tokens: 999999,
  cache_read_tokens: 1, cache_write_tokens: 1, ref: "ALF-310", launch_lane: "implementation", pr_number: 428,
  pr_state: "merged", pr_opened_at: "2026-10-03T11:00:00Z", pr_merged_at: "2026-10-03T12:00:00Z",
  pr_closed_at: "2026-10-03T12:00:00Z", human_commits_after_open: 0, base_sha: "main-from-history",
  builder_sha: null, prompt: "a prompt rebuilt from history", prompt_source: "reconstructed", spec_path: null,
  spec_blob_sha: null, skills: [], warnings: ["builder_changed_near_start"], session_record: null}]}' "$STOP" |
  curl -s -X POST "$APP/api/code/sessions" -H 'Authorization: Bearer demo-ledger-key' -H 'Content-Type: application/json' --data-binary @-
echo
curl -s "$MOCK/__mock__/state" | jq -c '.codeSessions[] | {prompt_source, base_sha, output_tokens, cost_usd, pr_state, launch_lane, warnings}'
