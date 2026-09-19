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
- **Title comes from the Subject; the canonical URL is the first `/p/<slug>` link on any host, with
  an optional `/pub/<name>` in front of it.** The 2026 template links the post only as
  `open.substack.com/pub/<name>/p/<slug>` (twice, the second carrying `READ IN APP`) and carries no
  bare `<pub>.substack.com/p/<slug>` anchor at all; a custom-domain publication still might, so both
  shapes count and first-in-document-order decides between them. A `substack.com/redirect/…` link is
  never unwrapped — its base64 payload does hold the post's URL, but the wrapper expires, so the
  stored link has to be the one that still resolves. Only `http:`/`https:` anchors count.
  — `workers/src/reader/extract.ts`
- **A publication's domain drops the section tag.** One publication mails from several section
  handles (`<pub>+<section>@substack.com`); the tag names the section and never appears in a host,
  so the domain is `<pub>.substack.com` while the handle keeps the tag (matching is on the handle).
  — `workers/src/reader/discovery.ts`
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
- **A paywalled post's stored text is the teaser, not the post.** The review's podcast/video post
  stops after ~430 words with an `Upgrade to paid` call in its last 250 characters, and nothing on
  the row says the body was cut — the summariser reads the teaser as if it were the whole piece.
  Detecting the cut and marking the row is Story 2's.
- **The byline is in the markup as well as in `From`.** Every post mail carries a
  `https://substack.com/@<handle>` anchor whose text is the author's name, sitting ahead of the post
  link. `From` arrives in three shapes (the publication's name, the author's name, and
  `<Author> from <Publication>` — the last of which `extract.ts` now unpicks), so the byline anchor
  is the steadier source for `author` and the natural input to an authors/publications surface.
- `refresh()` keeps the local row for any post this tab wrote that its read cannot answer for
  (`replaceAll`'s `keep`): one REFCOUNT map of writes still in flight (two writes can overlap on
  one row, and the last of them is what releases it) plus one set per read still in the air,
  opened by `beginRead()` and seeded at that instant with whatever was pending, then added to for
  every later write. `markOpened` is a write like any other and reconciles only `opened_at`. A
  realtime channel must open a read the same way. — `frontend/lib/stores/reader-store.tsx`

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

- The anchor-text fallback (`workers/src/reader/extract.ts` `VIEW_IN_BROWSER`) exists only for
  templates that carry no post path at all; the live template's `READ IN APP` sits ON the
  `/pub/…/p/…` link, which the path rule takes first. `read in app` is in the alternation anyway,
  for the mail that has the words and not the link.
- The `read-in-app` fixture carries no post path of any shape, so it's what exercises that fallback
  rather than the path rule.
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
- RFC 2047 encoded words are decoded now, not stored verbatim — `decodeEncodedWords` in
  `workers/src/comms/email-text.ts`, wired into the reader's title and into the comms mirror's
  `subject` and `sender_name`. Q and B, UTF-8 and latin1, two ADJACENT words joined with no space
  between them (Substack splits a long subject mid-word), anything unreadable left as it arrived.
  One question stays open: whether Gmail's API ever hands a header already decoded. The owner's
  captured `messages.get?format=full` did not — every non-ASCII subject arrived encoded — and the
  decoder is a no-op on a header that is already plain, so the cost of being wrong about it is nil.
- Substack's HTML opens with two `display:none` preheaders, the second ~400 characters of
  `&#847;&nbsp;&#8199;&#173;`. `htmlToText` drops `display:none` elements with their content and
  strips the invisible code points that survive entity decoding; without it every post's
  `word_count` carried some 200 empty words. Known limit: the strip ends at the first matching
  close tag, so a `display:none` div holding another div loses only its head. —
  `workers/src/comms/email-text.ts`

## Checkpoint results

_Filled in by the owner after the deploy._

- Did a message the Gmail filter archived on arrival still reach the Reader within ten minutes?
- The eval over five real posts (`npm run eval:reader -w workers -- --query "from:substack.com
  newer_than:14d" --limit 5`): headline and gist of each; did the consensus post come back with an
  empty `novel_ideas`?
- The measured volume: inbound `has_list_header` Substack messages per day over the last two weeks.
- The Worker's CPU-time and subrequest readings from the Cloudflare dashboard after the first full day.

## Story 2 build notes

What the second story's build learned that its own spec does not say. Same rule as above: only
what a reader who wasn't here needs.

- **The ceiling columns did not pre-exist.** Story 1 kept `reader_health` to
  `last_run_at`/`last_success_at`/`last_error`/`last_error_at` and derived the ceiling from a count
  over `reader_posts.model_called_at`, so `daily_cap`, `calls_today` and `calls_day` are ALL new
  here and all three are stamped by the tick on the health writes it was already making. The tick
  reads the count BEFORE it stamps the run start, so BOTH writes carry all three columns: a start
  stamp that moved `last_run_at` into a new day while the row still held the previous day's count
  would describe a budget already spent for the length of the first tick after midnight.
  — `0036_reader_operability.sql`, `workers/src/reader/health.ts`, `workers/src/reader/scheduled.ts`
- **The summariser stalls on three signals, and `never` is the blank row only.** Either an error
  newer than the last success, or a `last_run_at` older than the stall window (the tick stamps a
  run every five minutes whether or not it finds work, so a run three cadences old is the cron
  itself having stopped), or a claimed post waiting past the window with no summary and no clean
  tick pass inside it. Only that third one is suppressed while the ceiling is reached, because
  only then is waiting the designed behaviour. `never` means a row with no run AND no error: the
  tick stamps its pre-flight failures — an unparsable cap, a missing credential — before it
  records a run, so "no run, an error" is a misconfigured deploy shouting, not a cron that never
  fired, and the owner is owed the tick's own words rather than a shrug at the schedule.
  — `lib/reader/health.ts`, `components/reader/reader-header.tsx`
- **`last_post_at` is a view, not a column.** `v_reader_publications` is the roster plus
  `max(received_at)` over its posts; the store reconciles a publication PATCH as a shallow patch,
  never a replace, so the server's table row cannot overwrite the derived column with `undefined`.
  — `lib/data/reader-publications.ts`, `lib/stores/reader-settings-store.tsx`
- **Selection did not exist on a row; the card click now does both.** Story 1's row had only an
  expansion state, so `PostList` owns the selection and a card click selects AND toggles the
  overview — one gesture, so a mouse and a keyboard owner never disagree about which row is live.
  Escape drops the selection only; it leaves an open panel open.
- **`unarchive` is new** (Story 1 shipped three store actions and no caller for the fourth), and
  `replaceAll`'s keep-rule grew an archive-aware clause: a row the active read does not name
  survives when it is archived or when this tab wrote it, and is dropped otherwise.
- **There is no "no-text marker" to key off.** Story 1 never shipped one, so the row hides the
  re-summarise verb on `word_count === 0` and the route is what tells a stale tab which of its
  three refusals applies — swept, never had a body, or already queued. Its pre-read asks for
  `text_swept_at`, `word_count` and `summary_state`, never `text`: the presence signal the UI
  draws the verb from is the one the route refuses on, so the two cannot disagree, and no post
  body crosses the wire to be null-checked. The already-queued rule rides the WRITE as well as
  the pre-read (`.neq('summary_state','pending')`): the pre-read only describes the row a moment
  ago, so a tick that leases it in between matches nothing and gets the same 409 rather than
  having its lease cleared and its attempts reset mid-run.
  — `components/reader/post-row.tsx`, `app/api/reader/posts/[id]/route.ts`, `lib/data/reader.ts`
- **The reading list's heading kept Story 1's words** ("Reader", "N to read") rather than the
  spec's mockup wording; the health block sits beside it and the banner above it.
- **Hints are verified by their class, not by a media query.** jsdom has no layout, so
  `post-row.styles.test.ts` pins `hidden md:inline-flex` (and the absence of `sm:`) and the
  Storybook baselines carry the desktop rendering.
- **Live updates (realtime) were dropped**, per the story's own S2-11 escape hatch: a Postgres
  change payload carries the whole row, so every `reader_posts` UPDATE would stream up to 400 000
  characters of `text` and Supabase drops payloads over its size limit — the posts most worth
  summarising are exactly the ones that would never arrive. The migration carries no
  `supabase_realtime` line and the store has no subscription; the focus/visibility refetch covers
  the common case. Still the obvious next step if a surface needs it.
- **Comms was not edited.** Two pure functions are imported read-only (`accountHealth` from
  `@/lib/comms`, `formatElapsed` from `@/components/comms/comms-format`), plus `isHotkeyBlocked`
  from `@/lib/comms/hotkeys` as Story 1's `message-row.tsx` already does. Test-side there is a
  fourth import, `makeCommAccount` from `@/lib/comms/fixtures`, which seeds the mailbox the
  health surface reads in eleven files — the three Reader stories, six unit tests and two E2E
  specs. The one exception that writes to comms is a test: `renderWithProviders` mounts every
  module's provider, so the Reader store's new health refetch had to be stubbed in
  `comms-queue-view.test.tsx`.
- **`settle()` is duplicated, and that is a debt rather than a design.** The Reader needs comms'
  promise-swallowing helper, and the honest fix is one shared `lib/` helper both callers import —
  a behaviour helper's place under the frontend-architecture skill, which names "defined
  identically in two files" as an anti-pattern. That fix edits comms' own files, which this story
  deliberately does not, so `components/reader/publications-settle.ts` is a copy until the
  consolidation happens. Same for `publications.styles.ts`'s three card strings, and next to
  folding comms' `AccountDot` onto the new `StatusDot`.
- **The paywalled-teaser marker from Story 1's handoff was not built** — nothing detects the cut,
  and `headline` is still stored and unrendered.
