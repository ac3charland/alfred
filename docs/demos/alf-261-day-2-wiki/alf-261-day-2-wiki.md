---
branch: claude/alf-261-day-2-wiki-d4kb4q
---

# ALF-261 · Day 2: the knowledge wiki inside Alfred

*2026-09-25T23:56:10.115Z*

Day 2 of the knowledge-wiki epic (ALF-259) puts the wiki inside Alfred in both directions. **Out:** a Reader post's Novel ideas and an Inbox capture classified as **Knowledge** are committed into the wiki repo's `inbox/` through GitHub's Git Data API. **In:** the Worker snapshots the repo's pages into `wiki_pages` on every push to `main` (and daily as a safety net), and a fifth module, **Wiki**, reads that snapshot — index, sections, rendered pages with backlinks, body search, and a place in ⌘P and ⌘K.

Everything below runs against the E2E harness's in-memory backend (`frontend/scripts/mock-supabase.mjs`), which now also plays the wiki repo: it serves the six Git Data API endpoints the writer calls under `/__mock__/github/…` (bearer `mock_wiki_token`) and records every commit it is handed. The app runs as the **Personal** deployment — `WIKI_GITHUB_TOKEN`, `WIKI_REPO` and `WIKI_GITHUB_API_URL` set, server-side only. The screenshots were driven through the Playwright harness (real login, seeded per journey); the `exec` blocks boot the production build themselves and re-run under `npm run demo -- verify`.

## 1. Reader: send Novel ideas to the wiki

A done post, collapsed. Nothing about the row changes until its overview is open.

![](alf-261-day-2-wiki-image-1.png)

The overview's **Novel ideas** become a checklist once a wiki writer is configured, with **Send all to wiki** on the heading row.

![](alf-261-day-2-wiki-image-2.png)

Ticking bullets reveals the selection bar under the list — the count, **Send to wiki**, and Clear. The reveal is motion, so here it is as a GIF: tick one, tick a second, then clear both and watch the bar fold away.

![Ticking two Novel ideas reveals the selection bar; clearing them folds it away](alf-261-day-2-wiki-video-3.gif)

Two ticked, bar open:

![](alf-261-day-2-wiki-image-4.png)

**Send to wiki** — the button reads *Sending…* while the commit is in flight (the send route was held for 2.5s in this capture so the state is visible).

![](alf-261-day-2-wiki-image-5.png)

Sent: both bullets lose their checkbox and wear a **Sent** mark, and the bar folds away. The marks are stored on the post (`reader_posts.wiki_sent_ideas`), so they survive a reload.

![](alf-261-day-2-wiki-image-6.png)

**Send all to wiki** sends every bullet still unsent, as a second commit into a fresh folder. With nothing left, the button becomes **All sent to wiki**.

![](alf-261-day-2-wiki-image-7.png)

On a deployment with no writer (the Work instance), the section is today's plain list — no checkboxes, no send affordance:

![](alf-261-day-2-wiki-image-8.png)

## 2. Inbox: classify as Knowledge, dispatch to the wiki

Three captures and a task. **Knowledge** is a new item type; a knowledge row wears a lightbulb glyph.

![](alf-261-day-2-wiki-image-9.png)

The row menu's **Classify as…** gains **Knowledge**:

![](alf-261-day-2-wiki-image-10.png)

Classified — the lightbulb names the row, and because the wiki is connected it is dispatch-ready (the green dot):

![](alf-261-day-2-wiki-image-11.png)

The bulk bar's **Classify as** carries Knowledge too:

![](alf-261-day-2-wiki-image-12.png)

Three knowledge rows selected, all ready — **Dispatch** sends them in one request:

![](alf-261-day-2-wiki-image-13.png)

One commit into the wiki, one `inbox/` folder per idea; the rows leave Alfred and the toast says where they went.

![](alf-261-day-2-wiki-image-14.png)

Where no writer is configured, a knowledge row is never ready — the readiness line says why instead of offering a dispatch that could only fail (Storybook, `Tasks/InboxBulkBar › KnowledgeWikiNotConnected`):

![](alf-261-day-2-wiki-image-15.png)

## 3. The send routes' contract, against the mock GitHub

Both routes are one request, one commit. The helper `with-app.sh` builds the app against the mock, boots both, signs in with `@supabase/ssr` (so the session cookie is the library's own, not hand-built) and runs one section of `send-contract.mjs`. Today's UTC date — the folder prefix and every `captured` — is masked as `<today>`; the mock numbers its shas in sequence, so everything else is literal.

### POST /api/reader/posts/:id/wiki

Two picked bullets → one commit on `main` whose parent is the old head, holding a brand-new `inbox/<today>-<slug>/` folder with the post's text as `source.md` and the picks as `picks-<today>.md`, both under the wiki's frontmatter contract. The response is the row as the **list** shows it: it carries the new `wiki_sent_ideas` but **no `text` key** — the post body goes to GitHub and never back to the client. A repeat send has nothing left to send and commits nothing; a bullet the overview no longer offers is a 409.

```bash
docs/demos/alf-261-day-2-wiki/with-app.sh reader 2>/dev/null
```

```output
POST /api/reader/posts/55555555-5555-4555-8555-555555555561/wiki
{
  "ideas": [
    "Environment design beats willpower for the first thirty days.",
    "Streak-tracking helps only until the first miss."
  ]
}

→ 200  (the row, as the list shows it)
id              55555555-5555-4555-8555-555555555561
wiki_sent_ideas [
  "Environment design beats willpower for the first thirty days.",
  "Streak-tracking helps only until the first miss."
]
has "text" key  false
body anywhere   false

── the commit on the mock GitHub ──
main moved      c000012000000000000000000000000000000000 → c000018000000000000000000000000000000000
parents         ["c000012000000000000000000000000000000000"]
message         "add: Why habits stick"
commits on main 2 (the mock's init commit + this one)
files
  inbox/<today>-why-habits-stick/picks-<today>.md
  inbox/<today>-why-habits-stick/source.md
inbox/ now      ["<today>-why-habits-stick"]

── inbox/<today>-why-habits-stick/picks-<today>.md ──
---
source_type: "reader-post"
origin: "model-derived"
title: "Why habits stick"
author: "Jane Doe"
source_url: "https://janedoe.substack.com/p/why-habits-stick"
published: "2026-09-16"
captured: "<today>"
via: "alfred-reader"
external_id: "alfred:reader-post:55555555-5555-4555-8555-555555555561"
---

- Environment design beats willpower for the first thirty days.
- Streak-tracking helps only until the first miss.

── inbox/<today>-why-habits-stick/source.md ──
---
source_type: "reader-post"
origin: "third-party"
title: "Why habits stick"
author: "Jane Doe"
source_url: "https://janedoe.substack.com/p/why-habits-stick"
published: "2026-09-16"
captured: "<today>"
via: "alfred-reader"
external_id: "alfred:reader-post:55555555-5555-4555-8555-555555555561"
fidelity: "full-text"
---

Habits are the compound interest of self-improvement.

Sending the same two again: nothing left to send, so no commit.
→ 200  main still at c000018000000000000000000000000000000000  commits 2

A bullet the overview no longer offers:
→ 409  {"error":"That idea isn't in this post's overview any more"}
```

### POST /api/wiki/items

Two knowledge rows → ONE commit with one folder each, each holding a `notes-<today>.md` (`origin: mine`, `via: alfred-inbox`, the item id as `external_id`); the rows are deleted from Alfred by `send_items_to_wiki`. A row that is not knowledge refuses the whole request before anything is committed.

```bash
docs/demos/alf-261-day-2-wiki/with-app.sh inbox 2>/dev/null
```

```output
POST /api/wiki/items
{
  "ids": [
    "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
    "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c"
  ]
}
→ 200  {"sent":["2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b","3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c"]}

── ONE commit for both, one folder each ──
main moved      c000012000000000000000000000000000000000 → c000019000000000000000000000000000000000
parents         ["c000012000000000000000000000000000000000"]
message         "add: 2 sources"
commits on main 2 (the mock's init commit + this one)
files
  inbox/<today>-capture-first-triage-later/notes-<today>.md
  inbox/<today>-tests-are-back-pressure-on-generation/notes-<today>.md
inbox/ now      ["<today>-tests-are-back-pressure-on-generation","<today>-capture-first-triage-later"]

── inbox/<today>-capture-first-triage-later/notes-<today>.md ──
---
source_type: "idea"
origin: "mine"
title: "Capture first, triage later"
author: null
source_url: "https://example.com/capture-first"
published: null
captured: "<today>"
via: "alfred-inbox"
external_id: "alfred:item:3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c"
---

Capture first, triage later

── inbox/<today>-tests-are-back-pressure-on-generation/notes-<today>.md ──
---
source_type: "idea"
origin: "mine"
title: "Tests are back-pressure on generation"
author: null
source_url: null
published: null
captured: "<today>"
via: "alfred-inbox"
external_id: "alfred:item:2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b"
---

Tests are back-pressure on generation

A red check steers the next attempt; a weakened one steers nothing.

Inbox rows left in Alfred: ["Renew passport"]

A task is not knowledge — refused whole, nothing committed:
→ 409  {"error":"Item 5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e is not a knowledge item"}
main still at c000019000000000000000000000000000000000
```

### Security invariants: the token and the post body stay on the server

**The GitHub token never reaches the client.** The only wiki config the browser receives is `{repo, writable}` — the server-rendered Reader page (RSC payload included) contains neither the token's value nor its variable name. **`reader_posts.text` is never in a client payload:** the post body appears zero times in the rendered page even though the post itself (its Novel ideas) is on it, and — above — the send route's response has no `text` key. `GET /api/wiki/pages` returns the index columns and the sync row only; page bodies load one at a time from `/api/wiki/page`. Signed out, every wiki route is a 401.

```bash
docs/demos/alf-261-day-2-wiki/with-app.sh secrets 2>/dev/null
```

```output
Signed out, every wiki route is a 401:
  GET  /api/wiki/pages                                              → 401
  POST /api/reader/posts/55555555-5555-4555-8555-555555555561/wiki  → 401
  POST /api/wiki/items                                              → 401

GET /api/wiki/pages (signed in) — the index and the sync row, no bodies:
  → 200  keys ["pages","sync"]
  a page's keys  ["blob_oid","commit_oid","created","links","parse_error","path","section","sources","summary","synced_at","tags","title","updated"]
  its body text anywhere in the payload  false
  sync  {"id":1,"commit_oid":"cccccccccccccccccccccccccccccccccccccccc","synced_at":"2026-09-24T08:00:00.000Z","pending":0,"last_error":null,"last_error_at":null}

GET /reader — the whole server-rendered page, RSC payload included:
  wiki config handed to the client  {"repo":"ac3charland/knowledge","writable":true}
  "mock_wiki_token" occurrences       0
  "WIKI_GITHUB_TOKEN" occurrences   0
  post body (reader_posts.text)     0 occurrences
  a novel idea (proves the post IS rendered)  true
```

## 4. Worker: the page snapshot sync

`syncWiki` reconciles `wiki_pages` to the tree at the tip of the wiki's `main`: read the stored blob oids, one GraphQL query for the tree + commit, diff, one GraphQL query for the changed blobs, parse, one upsert, one delete, one `wiki_sync` write — never more than six subrequests however big the change. The harness `wiki-sync-harness.mjs` runs the real `syncWiki` (bundled from `workers/src/wiki/sync.ts` by esbuild) on a stubbed run: its `fetch` plays GitHub's GraphQL API and PostgREST in memory, and `now` is pinned.

**First run** — an empty snapshot meets a repo with three pages. Every page is parsed: title and `updated` from the YAML frontmatter, and `links` resolved to repo paths (the backlinks the module shows are these, reversed).

```bash
node docs/demos/alf-261-day-2-wiki/wiki-sync-harness.mjs first 2>/dev/null
```

```output
wiki_pages BEFORE (0 rows)
  (empty)
wiki_sync BEFORE  {}

syncWiki → {"ok":true,"commitOid":"1111111","changed":3,"removed":0,"pending":0}
subrequests 5 (ceiling 6)
  GET    wiki_pages
  POST   graphql  #1 tree + commit
  POST   graphql  #2 blobs ×3
  POST   wiki_pages
  POST   wiki_sync

wiki_pages AFTER (3 rows)
  wiki/concepts/habit-loop.md
    blob 645f46b  commit 1111111  title "Habit loop"  updated 2026-09-18
    links []
  wiki/concepts/habit-stacking.md
    blob 6cd90a4  commit 1111111  title "Habit stacking"  updated 2026-09-20
    links ["wiki/concepts/habit-loop.md","wiki/entities/james-clear.md"]
  wiki/entities/james-clear.md
    blob 13c8ed1  commit 1111111  title "James Clear"  updated 2026-09-18
    links []
wiki_sync AFTER  {"commit_oid":"1111111","synced_at":"2026-09-24T08:00:00.000Z","pending":0,"last_error":null}
```

**The next push** edits `habit-stacking.md`, deletes `james-clear.md` and adds a question whose YAML is broken. Only the two changed blobs are fetched; the unchanged page keeps its old `commit_oid`; the removed one goes in a single `DELETE … in.(…)`; the broken page is still stored — with its stem as title and a `parse_error` — rather than failing the run.

```bash
node docs/demos/alf-261-day-2-wiki/wiki-sync-harness.mjs push 2>/dev/null
```

```output
wiki_pages BEFORE (3 rows)
  wiki/concepts/habit-loop.md
    blob 645f46b  commit 1111111  title "Habit loop"  updated 2026-09-18
    links []
  wiki/concepts/habit-stacking.md
    blob 6cd90a4  commit 1111111  title "Habit stacking"  updated 2026-09-20
    links ["wiki/concepts/habit-loop.md","wiki/entities/james-clear.md"]
  wiki/entities/james-clear.md
    blob 13c8ed1  commit 1111111  title "James Clear"  updated 2026-09-18
    links []
wiki_sync BEFORE  {"commit_oid":"1111111","synced_at":"2026-09-24T08:00:00.000Z","pending":0,"last_error":null}

syncWiki → {"ok":true,"commitOid":"2222222","changed":2,"removed":1,"pending":0}
subrequests 6 (ceiling 6)
  GET    wiki_pages
  POST   graphql  #1 tree + commit
  POST   graphql  #2 blobs ×2
  POST   wiki_pages
  DELETE wiki_pages in.("wiki/entities/james-clear.md")
  POST   wiki_sync

wiki_pages AFTER (3 rows)
  wiki/concepts/habit-loop.md
    blob 645f46b  commit 1111111  title "Habit loop"  updated 2026-09-18
    links []
  wiki/concepts/habit-stacking.md
    blob e3f0cbb  commit 2222222  title "Habit stacking"  updated 2026-09-25
    links ["wiki/concepts/habit-loop.md","wiki/questions/do-streaks-help.md"]
  wiki/questions/do-streaks-help.md
    blob 3612906  commit 2222222  title "do-streaks-help"  updated null
    links []
    parse_error "invalid frontmatter YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:"
wiki_sync AFTER  {"commit_oid":"2222222","synced_at":"2026-09-25T09:17:00.000Z","pending":0,"last_error":null}
```

**A failed run** — GraphQL answers the tree query with an `errors` entry (it does that with a 200). The sync throws rather than reading it as an empty tree (which would delete every page), so the pages are untouched and `wiki_sync` records `last_error`/`last_error_at` while keeping the last good `commit_oid`/`synced_at` — exactly what the module's *sync failed* banner reads (§5).

```bash
node docs/demos/alf-261-day-2-wiki/wiki-sync-harness.mjs failed 2>/dev/null
```

```output
wiki_pages BEFORE (3 rows)
  wiki/concepts/habit-loop.md
    blob 645f46b  commit 1111111  title "Habit loop"  updated 2026-09-18
    links []
  wiki/concepts/habit-stacking.md
    blob 6cd90a4  commit 1111111  title "Habit stacking"  updated 2026-09-20
    links ["wiki/concepts/habit-loop.md","wiki/entities/james-clear.md"]
  wiki/entities/james-clear.md
    blob 13c8ed1  commit 1111111  title "James Clear"  updated 2026-09-18
    links []
wiki_sync BEFORE  {"commit_oid":"1111111","synced_at":"2026-09-24T08:00:00.000Z","pending":0,"last_error":null}

syncWiki → {"ok":false,"error":"GitHub GraphQL tree returned errors: API rate limit exceeded for installation"}
subrequests 3 (ceiling 6)
  GET    wiki_pages
  POST   graphql  #1 tree + commit
  POST   wiki_sync

wiki_pages AFTER (3 rows)
  wiki/concepts/habit-loop.md
    blob 645f46b  commit 1111111  title "Habit loop"  updated 2026-09-18
    links []
  wiki/concepts/habit-stacking.md
    blob 6cd90a4  commit 1111111  title "Habit stacking"  updated 2026-09-20
    links ["wiki/concepts/habit-loop.md","wiki/entities/james-clear.md"]
  wiki/entities/james-clear.md
    blob 13c8ed1  commit 1111111  title "James Clear"  updated 2026-09-18
    links []
wiki_sync AFTER  {"commit_oid":"1111111","synced_at":"2026-09-24T08:00:00.000Z","pending":0,"last_error":"GitHub GraphQL tree returned errors: API rate limit exceeded for installation","last_error_at":"2026-09-25T09:17:00.000Z"}
```

## 5. The Wiki module

**Index** — every page grouped by section, with counts in the sidebar and the sync state in the header.

![](alf-261-day-2-wiki-image-16.png)

**A section** (`/wiki/concepts`):

![](alf-261-day-2-wiki-image-17.png)

**A page** (`/wiki/concepts/habit-stacking`), rendered markdown: in-app links to other pages (*James Clear*, *habit loop*), a link to a page that does not exist yet (dotted, *implementation intentions*), raw citations opening the file on GitHub (↗), an external link, a heading anchor (`#where-the-sources-disagree`), then **Sources** and **Linked from** (backlinks).

![](alf-261-day-2-wiki-image-18.png)

**Search** — titles and summaries first:

![](alf-261-day-2-wiki-image-19.png)

…and a word only in a page's body lands under **In page text**, with the hit highlighted in a snippet:

![](alf-261-day-2-wiki-image-20.png)

**Empty** — nothing synced yet:

![](alf-261-day-2-wiki-image-21.png)

**Sync failed** — `wiki_sync.last_error_at` newer than `synced_at`: the header says so and keeps showing the last good snapshot.

![](alf-261-day-2-wiki-image-22.png)

## 6. ⌘P and ⌘K

**⌘P** global search gains a **WIKI** group matching page titles and summaries, beside Tasks:

![](alf-261-day-2-wiki-image-23.png)

**⌘K** gains a **Wiki** group — the module and its four sections:

![](alf-261-day-2-wiki-image-24.png)

![](alf-261-day-2-wiki-image-25.png)

## 7. Storybook baselines

Seven committed baselines moved, each because the shell gained a fifth module or the atoms gained a badge. Each diff image is baseline | diff | new, as the snapshot gate emits it; all were then approved with `npm run test:storybook:update -w frontend` and the regenerated PNGs are committed with this change.

`Atoms/Gallery › Library` — the new **Wiki** and **Concept** badges:

![](alf-261-day-2-wiki-image-26.png)

`Atoms/Gallery › MobileLibrary`:

![](alf-261-day-2-wiki-image-27.png)

`Shell/ViewSwitcher` — **Wiki** joins the switcher, in each of the four existing active states (Tasks, Code, Reader, Comms):

![](alf-261-day-2-wiki-image-28.png)

![](alf-261-day-2-wiki-image-29.png)

![](alf-261-day-2-wiki-image-30.png)

![](alf-261-day-2-wiki-image-31.png)

`Shell/SearchBox › OpenWithResults` — the dropdown gains a **WIKI** group (here *Firewall triage*, with its Wiki badge) below Tasks and Stories:

![](alf-261-day-2-wiki-image-32.png)

Twenty new baselines were captured: `reader-postrow--wiki-{nothing-ticked,two-ticked,sending,all-sent}`, `shell-viewswitcher--wiki-active`, `tasks-inboxbulkbar--classify-as-open-with-knowledge`, `tasks-taskrow--menu-knowledge`, `tasks-typeglyph--knowledge-icon`, and `wiki-wikiview--{index,section,page,page-loading,page-error,not-found,empty,sync-failed,search-pending,search-results,search-no-match,search-failed}`. A representative set:

`Reader/PostRow › WikiTwoTicked`:

![](alf-261-day-2-wiki-image-33.png)

`Reader/PostRow › WikiAllSent`:

![](alf-261-day-2-wiki-image-34.png)

`Shell/ViewSwitcher › WikiActive`:

![](alf-261-day-2-wiki-image-35.png)

`Tasks/TaskRow › MenuKnowledge`:

![](alf-261-day-2-wiki-image-36.png)

`Tasks/InboxBulkBar › ClassifyAsOpenWithKnowledge`:

![](alf-261-day-2-wiki-image-37.png)

`Wiki/WikiView › Index`:

![](alf-261-day-2-wiki-image-38.png)

`Wiki/WikiView › Page`:

![](alf-261-day-2-wiki-image-39.png)

`Wiki/WikiView › SearchResults`:

![](alf-261-day-2-wiki-image-40.png)

`Wiki/WikiView › SyncFailed`:

![](alf-261-day-2-wiki-image-41.png)

## 8. The cross-repo contract check, against the wiki repo

Run by hand against a clone of the wiki repo, which CI doesn't have — so this section is notes, not `exec` blocks.

- **Golden folders.** Alfred's own envelope and path code wrote four sends into the clone's `inbox/`: `2026-10-03-why-habits-stick` (full text + picks), `2026-10-03-why-habits-stick-2` (a swept post's pointer + picks), `2026-10-03-why-habits-stick-3` (picks alone) and `2026-10-03-spaced-repetition-works-because-forgetting-is-the-signal-not` (a knowledge dispatch's notes).
- **Wiki lint** (`npm run lint`): 0 errors, and 0 findings of any severity on Alfred's four folders (the only warnings are on the wiki's own existing pages).
- **File-batch dry run:** all four folders come back `new`.
- **Re-send:** sending the full-text post again and filing it gives `merged`, with the note "dropped inbox source.md (same body as the filed copy)". The second send costs nothing.
- **Read-side parity after this round:** Alfred's heading anchors (`lib/wiki/heading-ids.ts`) and the Worker's frontmatter and link parsing (`src/wiki/page.ts`) run through the same inputs as the wiki's own `headingAnchors`, `parseFile` and `extractLinks`. Result: 0 differences out of 52 heading bodies and 17 slugs, 0 out of 24 link-extraction bodies (the wiki's reading minus images, which the Worker skips on purpose), 0 out of 18 frontmatter splits, and 0 out of 18 renderer and Worker page-link checks.
