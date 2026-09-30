---
branch: claude/alf-309-ledger-backfill-b49vtd
---

# ALF-309 — the coding-session ledger

*2026-09-30T17:15:25.737Z*

`code_sessions` now holds one row per Claude Code session on this repo: model, effort and cost from the session record, the PR it produced and how that ended, and the launch prompt, spec and skills rebuilt from git history as they stood on main when the session started. `tools/session-ledger` builds the rows; two routes, keyed by a new `LEDGER_API_KEY` that nothing else accepts, read its inputs and upsert them.

Everything below runs on invented fixtures: the repo is public, so no real ledger data appears here.

## 1 · Build and report over the fixture set

The committed fixtures are 21 session-record lines (one invalid, one truncated, one a subagent could not fetch, one from another repo), 16 PRs and the ledger inputs. They join against a scripted git repo whose every commit is pinned: two versions of the builder file (`prompt=` then `q=`), skills and specs landing over time, a PR branch that merges main in and takes an owner commit after it opens, and a branch forked from an old commit.

```bash
rm -rf /tmp/alf-309-demo && npm run -s fixture-repo -w tools/session-ledger -- /tmp/alf-309-demo/repo
```

```output
c1      76beacce9669306d73b8a7cf8d70e91474d347d9
c2      b86bbe9b03c182010479d63f76dc337ec1d939ea
c3      9aa7cc97f70ae03b8258689a7f885fb30b2d888e
a1      b5b0d89be579249066eda9a42966752733070e4f
aMerge  e5e405f9251d69ee931ec319008edbfaea90f320
a2      16bda30ebbd5f147e638b4cfa71ce38d9a6a8e5c
m1      13e943ff74ccf83b103ef1426a0457b684862655
c4      9c9c7d233ab7ccd047b1857649d2abe1c3eb52f7
c5      b2e6e0a158cacc03d20e96332220972da43b88a4
fb1     b5795c6d332e74c3068487b78d0ee595339f40d9
m2      a50adf3ee6531d7f6e02bc35ac346397924932cd
fc1     7714f29bbcc440bca4da2171b81dfe5802eea920
b1      77665917815245e7b257ebdfce97d561eba8a2a7
```

Build joins them — the PR list and inputs come from files here (`--pulls`, `--inputs`); a real run fetches both. It names each record line it could not trust, and refuses to write inside a git work tree:

```bash
F=tools/session-ledger/fixtures
npm run -s ledger -w tools/session-ledger -- build --sessions $F/sessions --pulls $F/pulls.json --inputs $F/inputs.json --git-dir /tmp/alf-309-demo/repo --out /tmp/alf-309-demo/rows.ndjson 2>&1
echo "--- the same build, pointed inside the repo:"
npm run -s ledger -w tools/session-ledger -- build --sessions $F/sessions --pulls $F/pulls.json --inputs $F/inputs.json --git-dir /tmp/alf-309-demo/repo --out $F/leak.ndjson 2>&1 | sed "s#$PWD#<repo>#g"
ls $F/leak.ndjson 2>/dev/null || echo "(nothing written)"
```

```output
invalid record: batch-2.ndjson:10 (session_17Invalid) — created_at is not a timestamp
invalid record: batch-2.ndjson:12 (no id) — not JSON
built 20 rows → /tmp/alf-309-demo/rows.ndjson
--- the same build, pointed inside the repo:
session-ledger: --out <repo>/tools/session-ledger/fixtures/leak.ndjson is inside the git work tree <repo>; write it to the scratchpad.
(nothing written)
```

The run report: coverage, cost and outcome by lane (p90 only once a lane has 10 sessions; rework is not counted for document lanes or for sessions with no PR; a PR with no `alfred` block gets its own row, since it has an outcome but no lane), and the top warnings.

```bash
npm run -s ledger -w tools/session-ledger -- report /tmp/alf-309-demo/rows.ndjson
```

```output
code_sessions · ac3charland/alfred · 20 sessions · 2026-07-01 → 2026-07-12

coverage          rows   pct
  linked to a PR    16   80%
  ref known         16   80%
  prompt rebuilt     9   45%
  spec resolved      4   of 6 spec-reading sessions
  cost recorded     17   85%

lane                n  median $   p90 $   merged  human-reworked
  implementation    4     18.05       —        3        1
  bypass            4      5.25       —        1        0
  bug               2      8.75       —        0        0
  refinement        1     16.90       —        0        —
  spike             1     41.22       —        1        —
  epic-refinement   1     58.70       —        1        —
  epic-implementation
                    2     90.02       —        0        0
  (no PR)           4      4.46       —        —        —
  (PR, no block)    1      3.00       —        1        1

warnings: 21 · top: no_pr 4 · builder_missing 3 · builder_changed_near_start 2
```

## 2 · One rebuilt row

`session_01ImplSpec` is PR #415's shape with invented values: an implementation session whose prompt was replayed from the builder file as it stood on main when the session started (`base_sha`), naming two skills whose blobs resolve there, and a spec pinned by blob.

```bash
node -e '
const rows = require("fs").readFileSync("/tmp/alf-309-demo/rows.ndjson", "utf8").trim().split("\n").map(JSON.parse);
const r = rows.find((row) => row.session_id === "session_01ImplSpec");
const { session_record, prompt, ...rest } = r;
console.log(JSON.stringify(rest, null, 1));
console.log("--- prompt (" + r.prompt_source + "):");
console.log(prompt);
'
```

```output
{
 "session_id": "session_01ImplSpec",
 "repo": "ac3charland/alfred",
 "title": "ALF-9 implement the fixture story",
 "session_created_at": "2026-07-10T01:00:00.000Z",
 "status": "SESSION_STATUS_BUCKET_COMPLETED",
 "configured_model": "claude-sonnet-5-5",
 "model": "claude-sonnet-5-5",
 "served_model": "claude-sonnet-5-5",
 "effort_level": "xhigh",
 "cost_usd": 33.037491,
 "input_tokens": 1200,
 "output_tokens": 310420,
 "cache_read_tokens": 27937800,
 "cache_write_tokens": 931260,
 "ref": "ALF-9",
 "launch_lane": "implementation",
 "pr_number": 2,
 "pr_state": "merged",
 "pr_opened_at": "2026-07-10T02:30:00Z",
 "pr_merged_at": "2026-07-10T03:00:00Z",
 "pr_closed_at": "2026-07-10T03:00:00Z",
 "human_commits_after_open": 0,
 "base_sha": "b2e6e0a158cacc03d20e96332220972da43b88a4",
 "builder_sha": "9c9c7d233ab7ccd047b1857649d2abe1c3eb52f7",
 "prompt_source": "reconstructed",
 "spec_path": "docs/specs/ALF-9.html",
 "spec_blob_sha": "8e80d75df820d7c8134d0b295246ad8b6eee7c1e",
 "skills": [
  {
   "path": ".claude/skills/implement-spec/SKILL.md",
   "blob_sha": "f0299812af572abbe1b480da7e3f78411ce4ff03"
  },
  {
   "path": ".claude/skills/adversarial-review/SKILL.md",
   "blob_sha": "22f653e7d487e916b5c9a8b9f11660416f2e8411"
  }
 ],
 "warnings": []
}
--- prompt (reconstructed):
ALF-9: Give feedback when the button is pressed
Implement the spec at `docs/specs/ALF-9.html`, following `.claude/skills/implement-spec/SKILL.md` where present.
Then run one review round per `.claude/skills/adversarial-review/SKILL.md`.
Invented notes: show a toast.
```

The same story launched a week earlier replays the builder of *its* day (the first version, which still emitted `prompt=`): no review step, so one skill. And a session no PR links still gets its cost, its base, and — only because its title names a known ref — a ref, each null explained by a warning.

```bash
node -e '
const rows = require("fs").readFileSync("/tmp/alf-309-demo/rows.ndjson", "utf8").trim().split("\n").map(JSON.parse);
const pick = (id, keys) => { const r = rows.find((row) => row.session_id === id); return Object.fromEntries(keys.map((k) => [k, r[k]])); };
console.log(JSON.stringify(pick("session_02ImplOld", ["base_sha", "builder_sha", "human_commits_after_open", "skills", "warnings", "prompt"]), null, 1));
console.log(JSON.stringify(pick("session_13NoPrRef", ["ref", "launch_lane", "pr_number", "cost_usd", "base_sha", "builder_sha", "prompt", "skills", "warnings"]), null, 1));
'
```

```output
{
 "base_sha": "b86bbe9b03c182010479d63f76dc337ec1d939ea",
 "builder_sha": "76beacce9669306d73b8a7cf8d70e91474d347d9",
 "human_commits_after_open": 1,
 "skills": [
  {
   "path": ".claude/skills/implement-spec/SKILL.md",
   "blob_sha": "f0299812af572abbe1b480da7e3f78411ce4ff03"
  }
 ],
 "warnings": [
  "extra_prs"
 ],
 "prompt": "ALF-9: Give feedback when the button is pressed\nImplement the spec at `docs/specs/ALF-9.html`, following `.claude/skills/implement-spec/SKILL.md` where present.\nInvented notes: show a toast."
}
{
 "ref": "ALF-9",
 "launch_lane": null,
 "pr_number": null,
 "cost_usd": 6.412208,
 "base_sha": "a50adf3ee6531d7f6e02bc35ac346397924932cd",
 "builder_sha": null,
 "prompt": null,
 "skills": [],
 "warnings": [
  "no_pr",
  "ref_from_title"
 ]
}
```

## 3 · The routes, live

The real app, booted against the in-memory Supabase the E2E suite uses, with a demo ledger key and ingest key configured. `with-app.sh` seeds one project, epic and story, reads the ledger inputs, walks the auth and validation answers, then plays the case the recorded-wins rule exists for: a recording hook has already written a session's exact prompt mid-run, and the backfill later pushes all 20 fixture rows over it through the CLI.

```bash
docs/demos/alf-309-session-ledger/with-app.sh
```

```output
== GET /api/code/ledger-inputs with the ledger key: stories carry notes, never the spec snapshot
{"project":"ALF","stories":[{"ref":"ALF-9","notes":"Invented notes: show a toast.","spec_path":"docs/specs/ALF-9.html","has_spec_markdown":false}],"epics":["ALF-4"]}

== who gets in
ingest key (x-api-key) ........ HTTP 401
ingest key (Bearer) ........... HTTP 401
no auth ....................... HTTP 401
ledger key, unknown repo ...... HTTP 404
ledger key, malformed repo .... HTTP 400
ingest key on the write ....... HTTP 401
ledger key, empty batch ....... HTTP 400
ledger key, 101 rows .......... HTTP 413

== mid-session, a recording hook wrote session_01ImplSpec: its exact prompt, cost 1.00, PR still open
{"upserted":1,"kept_recorded":0}

== the backfill pushes all 20 fixture rows through the CLI (LEDGER_API_KEY and ALFRED_BASE_URL set)
pushed 20 rows (20 upserted, 1 kept recorded prompts)

== the stored row kept the recorded prompt; cost and PR state refreshed from the backfill
{"prompt":"the prompt exactly as the owner sent it","prompt_source":"recorded","cost_usd":33.037491,"pr_state":"merged"}
```

## 4 · The recorded-wins rule in real Postgres

The mock above mirrors the rule in JavaScript; the rule itself is SQL in `upsert_code_sessions`, where no client can bypass it. This boots the database package's throwaway cluster, applies every migration as production does, and calls the RPC as `service_role` — the role the keyed route's admin client runs as — with the hook's row, then the backfill's.

```bash
node docs/demos/alf-309-session-ledger/recorded-wins.mjs
```

```output
the recording hook writes → {"upserted":1,"kept_recorded":0}
a backfill re-run writes  → {"upserted":1,"kept_recorded":1}

The stored row:
  prompt        "ALF-9: the prompt exactly as the owner sent it"
  prompt_source "recorded"
  builder_sha   "builder-at-launch"
  base_sha      "head-at-session-start"
  cost_usd      "12.250000"
  pr_state      "merged"
  warnings      ["builder_changed_near_start"]
```

## 5 · Checking the subagents' copies

Subagents copy the session records, so the lead re-fetches a random sample itself and `verify` compares every field the ledger derives from. `sample` draws max(5, 5%) of the ids, skipping sessions still working, whose usage moves between copy and re-fetch. The ids are random, so this prints only what must hold.

```bash
F=tools/session-ledger/fixtures
npm run -s ledger -w tools/session-ledger -- sample --sessions $F/sessions > /tmp/alf-309-demo/sample.txt
echo "sampled: $(wc -l < /tmp/alf-309-demo/sample.txt) ids, $(sort -u /tmp/alf-309-demo/sample.txt | wc -l) distinct"
echo "found as records in the copies: $(cat $F/sessions/*.ndjson | grep -o "\"id\": \"session_[A-Za-z0-9]*\"" | grep -c -F -f /tmp/alf-309-demo/sample.txt)"
```

```output
sampled: 5 ids, 5 distinct
found as records in the copies: 5
```

A faithful re-fetch passes; one where a single `cost_usd` differs by a cent fails, naming the session and field.

```bash
F=tools/session-ledger/fixtures
head -n 1 $F/sessions/batch-1.ndjson > /tmp/alf-309-demo/verify-ok.ndjson
node -e "const r = JSON.parse(require(\"fs\").readFileSync(\"/tmp/alf-309-demo/verify-ok.ndjson\", \"utf8\")); r.external_metadata.usage.cost_usd += 0.01; console.log(JSON.stringify(r));" > /tmp/alf-309-demo/verify-bad.ndjson
npm run -s ledger -w tools/session-ledger -- verify --sessions $F/sessions --against /tmp/alf-309-demo/verify-ok.ndjson; echo "exit $?"
npm run -s ledger -w tools/session-ledger -- verify --sessions $F/sessions --against /tmp/alf-309-demo/verify-bad.ndjson; echo "exit $?"
```

```output
verified 1 session(s): every ledger field matches.
exit 0
mismatch: session_01ImplSpec usage
1 mismatch(es): re-fetch the offending batches.
exit 1
```
