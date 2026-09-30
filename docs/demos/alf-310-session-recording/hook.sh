#!/usr/bin/env bash
# Run the recording hook the way Claude Code does, over the committed transcript fixtures, in a
# scratch layout: a git repo standing in for the clone, a transcript directory with one readable
# subagent, one unreadable one and a .meta.json, and a private TMPDIR for the state file and log.
#
#   docs/demos/alf-310-session-recording/hook.sh dry-run   # print the stop body it would send
#   docs/demos/alf-310-session-recording/hook.sh gate      # not a cloud session, or no alfred: no-op
#   docs/demos/alf-310-session-recording/hook.sh refused   # alfred answers 401: logged, still silent
#   docs/demos/alf-310-session-recording/hook.sh live      # post both events to $ALFRED_BASE_URL
#
# Commits are pinned (fixed author, committer and dates), so every sha printed is stable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HOOK="$ROOT/tools/session-ledger/src/hook/cli.ts"
FIX="$ROOT/tools/session-ledger/src/hook/__fixtures__/transcript"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
for var in $(env | grep -o '^GIT_[A-Z_]*'); do unset "$var"; done
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.test GIT_COMMITTER_NAME=demo
export GIT_COMMITTER_EMAIL=demo@example.test GIT_AUTHOR_DATE=2026-10-03T09:00:00Z
export GIT_COMMITTER_DATE=2026-10-03T09:00:00Z

REPO="$WORK/repo"
mkdir -p "$REPO/.claude/skills/implement-spec"
printf 'fixture skill\n' > "$REPO/.claude/skills/implement-spec/SKILL.md"
git -C "$REPO" init -q -b main
git -C "$REPO" remote add origin https://github.com/ac3charland/alfred.git
git -C "$REPO" add -A && git -C "$REPO" commit -q -m base

T="$WORK/transcripts/session"
mkdir -p "$T/subagents/agent-broken.jsonl"
cp "$FIX/main.jsonl" "$T.jsonl"
cp "$FIX/agent-a1b2c3.jsonl" "$T/subagents/"
echo '{"agentType":"Explore"}' > "$T/subagents/agent-a1b2c3.meta.json"

export TMPDIR="$WORK/tmp" CLAUDE_PROJECT_DIR="$REPO" CLAUDE_CODE_REMOTE_SESSION_ID=cse_01FixtureRecorded
mkdir -p "$TMPDIR"
hook() { NODE_USE_ENV_PROXY=1 node "$HOOK" "$@"; }
stdin="{\"transcript_path\": \"$T.jsonl\"}"

case "${1:-}" in
  dry-run)
    hook session-start --dry-run > /dev/null   # writes the state file: the start commit
    echo "state file: $(cat "$TMPDIR/alfred-session-ledger/session_01FixtureRecorded.json")"
    echo "$stdin" | hook stop --dry-run
    ;;
  gate)
    code=0
    out="$(echo "$stdin" | CLAUDE_CODE_REMOTE_SESSION_ID= ALFRED_BASE_URL=http://127.0.0.1:9 hook stop 2>&1)" || code=$?
    echo "a local session (no cse_ id): exit $code, output: '${out}', scratch dir: $(ls "$TMPDIR" | wc -l) entries"
    unset ALFRED_BASE_URL
    code=0; out="$(echo "$stdin" | hook stop 2>&1)" || code=$?
    echo "no ALFRED_BASE_URL:           exit $code, output: '${out}', scratch dir: $(ls "$TMPDIR" | wc -l) entries"
    ;;
  live)
    code=0; out="$(hook session-start 2>&1)" || code=$?
    echo "session-start: exit $code, output: '${out}'"
    code=0; out="$(echo "$stdin" | hook stop 2>&1)" || code=$?
    echo "stop:          exit $code, output: '${out}'"
    if [ -e "$TMPDIR/alfred-session-ledger/hook.log" ]; then cat "$TMPDIR/alfred-session-ledger/hook.log"; else echo "hook.log: none (both writes accepted)"; fi
    ;;
  refused)
    node -e '
      const server = require("http").createServer((req, res) => {
        let body = ""; req.on("data", (c) => (body += c));
        req.on("end", () => { res.writeHead(401).end("{\"error\":\"Unauthorized\"}"); server.close(); });
      }).listen(54336);' &
    sleep 1
    hook session-start --dry-run > /dev/null
    code=0
    out="$(echo "$stdin" | ALFRED_BASE_URL=http://127.0.0.1:54336 LEDGER_API_KEY=demo-ledger-key hook stop 2>&1)" || code=$?
    wait
    echo "exit $code, output: '${out}'"
    echo "hook.log:"
    sed -E 's/^[0-9T:.-]+Z/<time>/' "$TMPDIR/alfred-session-ledger/hook.log"
    ;;
  *) echo "usage: hook.sh dry-run|gate|refused|live" >&2; exit 1 ;;
esac
