# Recording sessions into `code_sessions`

Every alfred cloud session writes its own ledger row as it runs. A project hook
(`.claude/settings.json` → `tools/session-ledger/src/hook/cli.ts`) posts to
`POST /api/code/sessions/record`, which calls `record_code_session`.

## Contents

- [What it writes, and when](#what-it-writes-and-when)
- [Who owns each column](#who-owns-each-column)
- [Running, disabling, debugging](#running-disabling-debugging)
- [Transcript facts](#transcript-facts)
- [Warning codes](#warning-codes)

## What it writes, and when

- **SessionStart** (`startup` only): `base_sha` (HEAD before the session changes anything),
  `builder_sha`, `repo`. Also writes a state file, `$TMPDIR/alfred-session-ledger/<session_id>.json`,
  that later stops read the start commit from.
- **Stop** (every turn's end): the whole picture so far, recounted from the transcripts, so a missed
  write is healed by the next: the prompt, the `skills` it names (blobs at `base_sha`), `ref`,
  models, effort, tokens per model split main thread vs subagents, `subagent_count`. Never a cost.
- **Cost** is priced in SQL on every write: `code_session_cost(usage_by_model, session_created_at)`
  over `model_price_history`. The Worker refreshes that history from Anthropic's pricing page on its
  daily `RETENTION_CRON` tick (one `model prices:` line in `wrangler tail`) and re-prices every
  recorded row when a rate changes. A model the history lacks leaves the cost null with
  `price_unknown` until then; a snapshot suffix (`-20251001`) is stripped, nothing else is guessed,
  and fast-mode usage is recorded as `<model>/fast`, so it stays unpriced.
- **Subagent tokens are often partial.** A subagent's transcript frequently keeps only each
  response's streaming-start entry, whose output count is a placeholder, so its real usage is not on
  disk. The hook still records what it saw but flags `subagent_usage_partial`, and such a row gets
  no cost rather than a low one.

Nothing after the session goes idle is recorded: PR outcomes, lane, title, status and
`session_record` still come from the [backfill](./backfill.md). Re-running it is safe.

## Who owns each column

The two RPCs enforce this, so the final row is the same whichever order the hook and a backfill run in:

| Class | Columns | Hook (`record_code_session`) | Backfill (`upsert_code_sessions`) |
| --- | --- | --- | --- |
| hook-owned | `*_tokens`, `cost_usd`, `served_model`, `subagent_count`, `usage_by_model`, `recorded_at` | every stop; usage never goes backwards | keeps them once the hook has recorded usage; never writes the last three |
| recorded-wins | `prompt`, `prompt_source`, `skills`, `base_sha`, `builder_sha` | first recorded prompt (and its skills) freezes; base/builder from session start | keeps them once recorded, except a start the hook missed (`start_unrecorded`) |
| platform-owned | `session_created_at`, `model`, `effort_level`, `ref` | fills only while null | overwrites, but never with a null on a recorded row |
| backfill-only | everything else | never | overwrites |

## Running, disabling, debugging

- **Runs only** when `CLAUDE_CODE_REMOTE_SESSION_ID` starts with `cse_` and `ALFRED_BASE_URL` is set,
  so local sessions and forks of the public repo skip it. **Disable** it by unsetting
  `ALFRED_BASE_URL` in the cloud environment.
- **Silent by design**: it always exits 0 and prints nothing (SessionStart stdout would enter the
  session's context). A failed write appends one line to `$TMPDIR/alfred-session-ledger/hook.log`:
  time · event · session · HTTP status or error name. The next stop is the retry.
- **Credentials**: the proxy adds the ledger credential, which Node's `fetch` only sees under
  `NODE_USE_ENV_PROXY=1` (the settings command sets it); a 401/403 in `hook.log` means the
  credential or that flag is missing.
- **Preview a stop** without posting: pipe `{"transcript_path": "<file>.jsonl"}` into
  `CLAUDE_CODE_REMOTE_SESSION_ID=cse_<id> node tools/session-ledger/src/hook/cli.ts stop --dry-run`;
  it prints the body it would send.

## Transcript facts

As of CLI 2.1.x; the hook's tests pin this shape, and an unrecognised shape degrades to nulls.

- The transcript is `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`; the hook's stdin carries its path
  as `transcript_path`. It holds no cost field anywhere.
- One API response is written as several `type:"assistant"` entries, each repeating the same
  `message.usage`: count one usage per `message.id`, or totals overcount.
- `message.usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` splits the
  cache writes; `server_tool_use.web_search_requests` counts searches (the rate table has no search
  price, so they're recorded, not priced).
- Subagents write `<transcript minus .jsonl>/subagents/agent-<id>.jsonl` (plus a `.meta.json`),
  entries `isSidechain: true` with their own model. A response is complete only once an entry for
  its `message.id` has a string `stop_reason`; many subagent responses never get one. The main
  transcript carries only a bare `totalTokens` per subagent (an `attachment.usage`), unpriceable.
- `message.usage.speed` is `"standard"` or `"fast"`.
- The launch prompt is the first `type:"user"` entry that isn't `isMeta` or a tool result.
- The ledger id is `session_` + the suffix of `CLAUDE_CODE_REMOTE_SESSION_ID=cse_…`.

## Warning codes

Set by the recording path; a backfill keeps them.

| Code | Meaning |
| --- | --- |
| `price_unknown` | a model in `usage_by_model` has no rate in `model_price_history` yet (a new model before the next daily fetch, or a `/fast` variant), so `cost_usd` is null |
| `start_unrecorded` | a stop found no state file (the container was re-provisioned), so base, builder and skills come from the backfill |
| `subagent_usage_partial` | a subagent transcript recorded some responses only by their streaming placeholder, so subagent tokens are understated and `cost_usd` is null |
| `subagents_unreadable` | a subagent transcript couldn't be read; the others still count |
| `transcript_regressed` | a stop counted fewer output tokens than already recorded, so the stored usage was kept; sticks once set |
