# ALF-232 — Reader module: notes for Story 2

What the first story's build learned that the epic spec does not say. Read the epic, then this,
then the code. Not a spec and not a diary: only what a reader who wasn't here needs.

## Where the build diverged from the epic

One line each, with the file that now holds the truth.

- **Thinking is disabled explicitly** (`thinking: { type: 'disabled' }`, `output_config.effort:
  'medium'`, `max_tokens: 4096`), unlike the classifier which omits the key. On Sonnet 5 an
  omitted key means adaptive thinking billed against `max_tokens`. — `workers/src/reader/summarize.ts`
- **A 60 s request timeout, one SDK retry, an eight-minute tick budget** (`READER_TICK_BUDGET_MS`),
  instead of the classifier's 10 s. — `workers/src/reader/summarize.ts`, `scheduled.ts`
- **Overlapping ticks are handled by a lease**, `reader_posts.summarizing_since`: a fresh post's
  insert is the claim; a retried pending post is claimed by a compare-and-set PATCH (`summary_state
  = pending`, lease null or older than 15 minutes). Every terminal patch releases it. — `worklist.ts`,
  `store.ts`
- **The daily ceiling is derived from the posts**, not counted on the health row: `model_called_at`
  is stamped on every model attempt (transport failures included, since a timeout may have been
  billed) and the tick counts rows since UTC midnight through a `Prefer: count=exact` HEAD-style
  read. `reader_health` keeps only `last_run_at`, `last_success_at`, `last_error`, `last_error_at`.
  — `store.ts` (`countRows`), `scheduled.ts`
- **No per-post `reader_publications.last_post_at` touch** — a publications view derives "last post"
  from `max(received_at)` over `reader_posts`. Column dropped from the schema.
- **Fixtures are Gmail `messages.get` JSON as TypeScript modules**, not `.eml`: the Worker's
  tsconfig has no `resolveJsonModule` and nothing parses RFC 822. — `workers/src/reader/fixtures/`
- **The eval script reads the mailbox** (`--query`, `--ids`) **or replays the fixtures** (`--fixtures`,
  `--dry-run`); there is no folder-of-`.eml` mode. — `workers/scripts/reader-eval.ts`
- **Title comes from the Subject; the canonical URL is the first `/p/<slug>` link on any host**
  (custom-domain publications and tracking hosts broke the "host is the publication's domain" rule);
  only `http:`/`https:` anchors count. — `workers/src/reader/extract.ts`
- **Model input is capped at 150 000 characters, stored text at 400 000**; read minutes are derived
  in the UI as `max(1, ceil(word_count / 230))`. — `prompt.ts`, `extract.ts`, `reader-format.ts`
- **No publications route in this story**: discovery seeds Substack senders; anything else is an
  insert in the SQL editor (recipe in `database/README.md`).
- **Vars fail closed**: a missing `READER_MODEL` or a non-positive-integer `READER_DAILY_CAP` is a
  systemic failure recorded on `reader_health` before the tick touches Gmail. — `workers/src/reader/config.ts`
- **A deleted or binned mailbox message claims the comms row and inserts nothing** (Gmail 404, or a
  200 carrying `TRASH`/`SPAM`), so it is never retried and never appears in the list. — `intake.ts`
- **The list never carries `text`**: one column list, `READER_POST_LIST_COLUMNS`, is shared by the
  seed, the GET route and the PATCH route. — `frontend/lib/data/reader.ts`
- **Three store actions, not four**: `archive`, `markOpened`, `refresh`. No `unarchive` until the
  archive view exists; the PATCH route accepts `{ archived: false }` anyway. — `reader-store.tsx`
- **Three comms edits, not two**: `isShelved`, the shelf branch of `getCommMessagesByScope`, and the
  store's realtime UPDATE allowlist (`messageUpdatePatch`) all learn `reader_claimed_at`, so a claim
  reaches an open tab live. `isQueued` is untouched.
- **The desktop sidebar is 256 px and the switcher's type is 13 px** — four 14 px labels did not
  fit 224 px. — `app-shell.tsx`, `view-switcher.tsx`
- **`headline` is stored, not rendered.** Nobody has defined "teaser" yet; the row draws eyebrow,
  meta, title, gist and verbs.
- **No index on `reader_publications(enabled)`** and none on `comm_messages`.
- **The cron-trigger cap**: the Free plan allows five cron triggers per account (Cloudflare limits
  page); this Worker now registers four. If both alfred instances' Workers live in one Cloudflare
  account that is eight, and the deploy will refuse — see "Checkpoint results".
- **The daily ceiling counts model calls, not HTTP requests** — the SDK's one retry means a day of
  retried transport failures can reach twice the cap in requests; 30 is sized with that headroom.
  — `workers/src/reader/config.ts`

## Names that won

- Store hooks — `frontend/lib/stores/reader-store.tsx`: `ReaderProvider`, `useReaderPosts`,
  `useActiveCount`, `useReaderActions` (→ `archive`, `markOpened`, `refresh`).
- Data functions — `frontend/lib/data/reader.ts`: `getReaderSeed`, `getReaderPosts`,
  `patchReaderPost`, `READER_POST_LIST_COLUMNS`.
- Request schemas — `frontend/lib/api/reader-schemas.ts`: `readerPostsQuerySchema`,
  `patchReaderPostSchema`.
- api-client wrappers — `frontend/lib/api-client.ts`: `fetchReaderPosts`, `patchReaderPost`.
- Worker exports:
  - `workers/src/reader/scheduled.ts`: `runReaderTick`, `READER_TICK_LIMIT`,
    `READER_TICK_BUDGET_MS`, `READER_ATTEMPT_CEILING`.
  - `workers/src/reader/extract.ts`: `extractPost`, `READER_TEXT_CHARS`.
  - `workers/src/reader/store.ts`: `countRows`, `insertPost`, `leasePost`, `patchPost`,
    `claimCommMessage`.
  - `workers/src/reader/worklist.ts`: `fetchRetries`, `fetchFresh`, `READER_LEASE_STALE_MS`.
  - `workers/src/reader/discovery.ts`: `discoverPublications`.
  - `workers/src/reader/health.ts`: `recordRunStart`, `recordRunSuccess`, `recordRunError`.
  - `workers/src/reader/summarize.ts`: `summarizePost`.
  - `workers/src/reader/schema.ts`: `READER_SUMMARY_SCHEMA`, `isReaderSummary`,
    `normalizeReaderSummary`, `READER_MAX_BULLETS`.
  - `workers/src/reader/prompt.ts`: `buildReaderRequest`, `READER_PROMPT_VERSION`,
    `READER_MODEL_INPUT_CHARS`.
  - `workers/src/reader/config.ts`: `readReaderConfig`, `READER_DEFAULT_DAILY_CAP`.
  - `workers/src/index.ts`: `READER_CRON`.
- Component names — `frontend/components/reader/`: `ReaderView` (`reader-view.tsx`), `ReaderNav`
  (`reader-nav.tsx`), `ReadingListView` (`reading-list-view.tsx`), `PostRow` (`post-row.tsx`),
  `PostOverview` (`post-overview.tsx`), `PostMarkers` (`post-markers.tsx`).
- Eval script flags — `workers/scripts/reader-eval.ts`: `--query`, `--ids`, `--limit`, `--model`,
  `--fixtures`, `--dry-run`.

## Story 2 inherits

- The two placeholder segments, `/reader/archive` and `/reader/publications`: each renders a
  heading plus an `EmptyState`, both from `ReaderView` in `frontend/components/reader/reader-view.tsx`.
- The PATCH route already accepts `{ archived: false }` — `patchReaderPostSchema`
  (`frontend/lib/api/reader-schemas.ts`) is a union over both directions, the store just never
  sends `false` yet.
- `reader_health`'s `last_run_at` / `last_success_at` / `last_error` / `last_error_at` columns
  are stamped every tick (`workers/src/reader/health.ts`) but nothing reads them back — no
  health surface exists yet.
- `frontend/lib/comms/hotkeys.ts` is importable as-is: the Reader can adopt Comms' row-hotkey
  convention (`RowHotkeyAction`, `RowHotkeyEvent`) without a reader-specific fork.
- "Last post" for a future publications view has to be derived as `max(received_at)` over
  `reader_posts` — there is no `reader_publications.last_post_at` column.
- The eval script's `--fixtures` mode (`workers/scripts/reader-eval.ts`, replaying
  `workers/src/reader/fixtures/`) is the route for turning the checkpoint's real posts into
  committed fixtures.
- `reader_posts.headline` is stored (`workers/src/reader/scheduled.ts` `applyOutcome`) but never
  rendered — `PostRow` draws eyebrow, meta, title, gist and verbs. Nobody has defined "teaser"
  yet.
- A row's eyebrow currently shows `reader_posts.author`, because `READER_POST_LIST_COLUMNS`
  (`frontend/lib/data/reader.ts`) carries no publication name — joining
  `reader_publications.name` into the list payload is a Story 2 decision.
- `ReaderEnv`'s optional vars are typed `KEY?: string`, not `KEY?: string | undefined`
  (`workers/src/reader/types.ts`) — a test spelling an unset var must `delete env.KEY` rather
  than set it to `undefined`.
- `frontend/lib/api/supabase-route-double.ts` gained a `.not()` stub on `TableChain`, for the
  archive-scope query's `.not('archived_at', 'is', null)`.
- `frontend/lib/test-utils.tsx`'s `renderWithProviders` gained a `reader` seed option
  (`initialPosts`), alongside the other modules' seeds.
- `refresh()` keeps the local row for any post this tab wrote that its read cannot answer for
  (`replaceAll`'s `keep`): two sets, one of writes still in flight and one of every write started
  since the read was ISSUED, cleared as the request goes out. `markOpened` reconciles only
  `opened_at`. A realtime channel must respect both sets. — `frontend/lib/stores/reader-store.tsx`

## Subrequest arithmetic as built

The table from `scheduled.ts`'s `READER_TICK_LIMIT` doc comment, verbatim:

| Unit | Fetches | Count |
|---|---|---|
| Per tick | token mint · discovery read · discovery upsert · roster read · worklist read · pending-retry read · ceiling count · health start · health end | 9 |
| Per fresh post | Gmail `messages.get` · insert post · stamp comms row · Anthropic ×2 (one SDK retry) · terminal patch | 6 |
| Per retried pending post | lease CAS · Anthropic ×2 · terminal patch | 4 |
| Worst tick (six fresh) | 9 + 6 × 6 | **45** |

`READER_TICK_LIMIT` is 6. One more fetch per post drops the limit to 5; two more drops it to 4.
Cost against this table before adding a retention step or any new per-post write.

## Scope that fell out

- The "View in browser" regex (`workers/src/reader/extract.ts` `VIEW_IN_BROWSER`) was widened
  with `(post )?` — Substack's real wording is "View this post in your browser", not the plain
  "view in browser" a narrower pattern would only match.
- The `roundup-view-in-browser` fixture carries no `/p/` link, so it's what exercises the
  `VIEW_IN_BROWSER` fallback rather than the `/p/` path.
- A retried pending post whose stored text has gone empty (a retention sweep nulled it) is
  filed `failed` with no model call — `prepareRetry` in `workers/src/reader/scheduled.ts`.
- Missing Gmail bindings (`GMAIL_OAUTH_CLIENT_ID` / `_SECRET` / `GMAIL_PERSONAL_REFRESH_TOKEN`)
  fail closed before the token exchange — `MISSING_GMAIL_BINDINGS` in `scheduled.ts`.
- `intake`'s count of rows inserted includes one immediately filed `failed` for an empty body —
  see `ReaderTickSummary.intake`'s doc comment, `workers/src/reader/scheduled.ts`.
- The eval script's cost line prices `claude-sonnet-5` at $2/$10 per million tokens
  (`workers/scripts/reader-eval.ts` `PRICES`, from the epic's cost table) — this disagrees with
  the `anthropic-api` skill's $3/$15. Unverified either way; flagged for the owner.
- The Free plan's cron-trigger cap (five per account) is unverified against the real account —
  see the checkpoint below.
- No `intake.test.ts`: its branches (404, binned, conflict, empty body) are pinned end-to-end
  through `scheduled.test.ts` instead of their own unit suite.

## Checkpoint results

_Filled in by the owner after the deploy._

- Did a message the Gmail filter archived on arrival still reach the Reader within ten minutes?
- The eval over five real posts (`npm run eval:reader -w workers -- --query "from:substack.com
  newer_than:14d" --limit 5`): headline and gist of each; did the consensus post come back with an
  empty `novel_ideas`?
- The measured volume: inbound `has_list_header` Substack messages per day over the last two weeks.
- The Worker's CPU-time and subrequest readings from the Cloudflare dashboard after the first full day.
