---
branch: claude/lucid-gates-jug4gp
---

# Reader: publications, health, re-summarise, archive, keyboard and retention

*2026-09-18T21:58:43.471Z*

The Reader module was a pipe with a list on the end of it: mail arrived, a Worker summarised it, and everything else — who gets claimed, whether the summariser is alive, re-running a summary, finding a post you put away — was a SQL query or a `wrangler tail`. This branch makes all of that reachable from the app, and bounds what the pipe stores.

Every screenshot here is the running app, driven through the Playwright mock backend — except in *The Storybook baselines that moved*, whose images are Storybook artefacts: one snapshot diff and the baselines it approved. The retention evidence is a real PostgreSQL cluster; the Worker evidence is a whole tick and the Worker's own `scheduled` handler, both run with a stubbed `fetch`.

## Publications — the roster, and who could join it

`/reader/publications` lists every publication with its name, handle, provenance chip, pause toggle, newest post and note; beneath it, every bulk sender of the last 30 days that is NOT on the roster, ranked by volume. Here: two enabled, one paused, and two candidates (Amazon at 5 messages ranks above Ben's Bites at 3 — the view ranks by volume, and nothing is filtered out for looking un-newsletter-ish).

![](reader-operability-image-1.png)

**Pause.** Tapping a publication's toggle flips it optimistically and the count line follows. A paused card is dimmed and keeps its posts; only future mail stops being claimed.

![](reader-operability-image-2.png)

**Rename.** The name is an editable field on the card — click, type, Enter.

![](reader-operability-image-3.png)

It persists, and the roster re-sorts into name order around it.

![](reader-operability-image-4.png)

**Promote a candidate.** "Add" puts the sender on the roster as `owner`, enabled, with the domain derived from the handle — carrying the display NAME the candidate row showed ("Ben's Bites", not the handle's local part "hello"). It leaves the candidates list in the same gesture, and lands in name order at the top.

![](reader-operability-image-5.png)

**Copy the Gmail filter query.** The button puts `from:(…)` over exactly the ENABLED handles, sorted, on the clipboard, and says so. It is disabled with a title when nothing is enabled.

![](reader-operability-image-6.png)

## Health — two dots, and at most one banner

The header carries a summariser dot and a Gmail (personal) dot, each with its state in the accessible label, and a sentence beneath any state that is not live. Above them, at most ONE banner renders, in a fixed precedence: a REFUSED mailbox → a stalled summariser → a mailbox merely gone quiet → the daily ceiling.

**Gmail dead wins over everything.** This seed has BOTH a refusing mailbox and a spent ceiling; the red banner is the one that renders, because nothing new is arriving to summarise or to spend the budget on. The Gmail dot goes red and carries how long it has been silent; the summariser dot stays green, because the summariser is fine.

![](reader-operability-image-7.png)

**Summariser stalled** — the tick recorded a failure more recently than a success. The banner is dated from when summarising actually stopped, not from when it was noticed, and quotes the tick's own words.

![](reader-operability-image-8.png)

**Daily ceiling reached** — amber and informational: the cap is read off the health row the tick stamps (30), and the four claimed posts waiting are counted as waiting for tomorrow rather than reported as a stall. Both dots stay green, because nothing is broken.

![](reader-operability-image-9.png)

**Never ran** — the row the migration seeds, with nothing stamped on it yet. An amber dot and a sentence, and deliberately no banner: before the first tick there is nothing to be stalled from, and the fix is the Worker's cron rather than anything in the app.

![](reader-operability-image-10.png)

## Re-summarise — one verb, and the three answers it can be refused with

One list, four states: a done row; a failed row the model itself is what went wrong on, whose body is still here, so **Retry summary** is offered; a refused row whose text the retention sweep took; and a failed row whose body never made it in at all. The last two carry no verb — a re-run of either could only fail the same way — and the italic line says which of the two it is.

![](reader-operability-image-11.png)

Under a done row's overview: the new stamp line — model, prompt version, summarised-at — beside the ghost **Re-summarise**. The stamp is what makes a re-run visible: without it "I re-ran it" and "nothing happened" look the same.

![](reader-operability-image-12.png)

Re-summarising sets the row pending with its attempts reset and **keeps the summary it already has** — gist and overview both, at the pending marker's opacity — so the owner is never shown a judgment that has not happened yet. The verb disappears while the row is queued.

![](reader-operability-image-13.png)

Neither of the two rows that cannot be re-run offers a verb: `word_count` and `text_swept_at` ride the list payload, so the row can tell "the sweep took it" from "there was never anything to take" without the body ever crossing the wire, and it ends each line with what the owner can still do. The route holds the same three refusals for a tab left open before the sweep ran — swept (naming the date), no stored text, and already queued — but it is a session-gated Next handler rather than anything on the mock's REST surface, so those are pinned in `app/api/reader/posts/[id]/route.test.ts` rather than shown here.

![](reader-operability-image-14.png)

## The archive round trip

Two posts on the reading list.

![](reader-operability-image-15.png)

Archiving one collapses it out of the list and the count follows.

![](reader-operability-image-16.png)

`/reader/archive` reads its own scope on first visit and folds the answer into the store's ONE post list — so the post archived a moment ago is the same row, not a second copy. Archive's slot carries **Unarchive**.

![](reader-operability-image-17.png)

Unarchiving is the same optimistic patch in the other direction; the archive drops to its empty state and the post is back on the reading list.

![](reader-operability-image-18.png)

## The keyboard

`j` selects the first row and the three `<kbd>` hints appear — on the selected row only, and only from desktop width.

![](reader-operability-image-19.png)

`v` toggles that row's overview. A letter, never Enter: the card and its verbs are focusable buttons that Enter would activate natively, firing two things at once.

![](reader-operability-image-20.png)

`e` archives it, and the selection moves to the row below rather than being dropped — so the next `e` has a target.

![](reader-operability-image-21.png)

## Retention — the ninety-day text sweep, against a real PostgreSQL

The E2E mock has no `reader_sweep_text`, so this runs against the database package's throwaway cluster with every migration applied exactly as production applies them. Four posts are inserted either side of the window and the function is called the way the Worker loops it — one batch per call, until a batch returns 0 (`p_limit` is 1 here so the batching is visible). The 91- and 120-day-old posts lose their text and gain `text_swept_at`; the 89-day-old one is untouched; every summary survives. The fourth is 200 days old and arrived with nothing readable in it: the sweep passes over it, so `text_swept_at` stays null and the row keeps saying "there was never a body" rather than "the sweep took it". Last, the two floors: both arguments raise below 1 rather than clamping, so an obviously-wrong call is loud — `p_days => 0` would null every body in the table in one call, and `p_limit => 0` would leave the Worker's loop spinning on a batch that can only ever report 0.

```bash
node docs/demos/alf-234-reader-operability/retention-sweep.mjs
```

```output

Before the sweep:
  A · 91 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  B · 89 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  C · 120 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  D · 200 days, no body  text=   0 chars  swept=false  title/gist/overview/summarized_at kept=true

reader_sweep_text(90, 1), called until it returns 0:
  call 1 → 1 row(s) swept
  call 2 → 1 row(s) swept
  call 3 → 0 row(s) swept

After the sweep:
  A · 91 days old  text=   0 chars  swept=true   title/gist/overview/summarized_at kept=true
  B · 89 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  C · 120 days old  text=   0 chars  swept=true   title/gist/overview/summarized_at kept=true
  D · 200 days, no body  text=   0 chars  swept=false  title/gist/overview/summarized_at kept=true

Both floors, from a session that asks for a nonsense argument:
  reader_sweep_text(0, 1) → reader_sweep_text: p_days must be at least 1, got 0
  reader_sweep_text(90, 0) → reader_sweep_text: p_limit must be at least 1, got 0
```

## The Worker — the ceiling stamp, and the daily sweep's own log lines

The Worker is headless: its surfaces are the calls it makes and the lines it logs. Section 1 runs a whole five-minute tick — `runReaderTick` itself, not its health writers — against a stubbed Supabase and a stubbed token mint, with every read answering empty so the loop has no work to do; what is captured is the tick's own request trace and the two `reader_health` PATCH bodies. Read the trace in order: the ceiling count (`Prefer: count=exact`, answered with a `Content-Range` of 24) is request **1** and the run-start stamp is request **2**. That is the hoist, driven rather than asserted, and it is why BOTH writes carry the whole ceiling rather than the cap alone — a start stamp that moved `last_run_at` into a new day while the row still held the previous day's count would describe a budget already spent. The stamped cap is also what lets the ceiling banner say "(30)" without the frontend knowing a deploy var.

Then the daily cron, three ways. The clean run: the comms sweep, then the reader's, each logging its own line. The sweep that commits two batches and then breaks: each batch is its own transaction, so the run reports the **2 posts swept** it really did commit beside the failure rather than throwing a true number away. And the sweep that breaks before any batch commits: "did not run", the one case where nothing was in fact swept — with the comms sweep beside it still having run, because each unit owns its own try/catch.

```bash
node docs/demos/alf-234-reader-operability/worker-evidence.mjs
```

```output
1 · One whole tick: what it reads, in what order, and what it stamps
  1. GET /rest/v1/reader_posts  (Prefer: count=exact — the ceiling count)
  2. PATCH /rest/v1/reader_health
  3. GET /rest/v1/v_reader_discovery
  4. GET /rest/v1/reader_publications
  5. GET /rest/v1/reader_posts
  6. GET /rest/v1/v_reader_worklist
  7. POST /token
  8. PATCH /rest/v1/reader_health
  failures: []

  The reader_health writes, in order:
    {"calls_day":"2026-09-18","calls_today":24,"daily_cap":30,"last_run_at":"2026-09-18T09:17:00.000Z"}
    {"calls_day":"2026-09-18","calls_today":24,"daily_cap":30,"last_success_at":"2026-09-18T09:17:00.000Z"}

2 · The daily retention cron (17 9 * * *): comms, then the reader
comms retention: 12 messages deleted
reader retention: 3 posts swept
  POST /rest/v1/rpc/comm_sweep_expired  {"p_days":60}
  POST /rest/v1/rpc/reader_sweep_text  {"p_days":90,"p_limit":5000}
  POST /rest/v1/rpc/reader_sweep_text  {"p_days":90,"p_limit":5000}
  POST /rest/v1/rpc/reader_sweep_text  {"p_days":90,"p_limit":5000}

3 · A reader sweep that commits two batches and then breaks
comms retention: 6 messages deleted
reader retention: 2 posts swept
reader: reader retention: Supabase POST rpc/reader_sweep_text failed: 500 canceling statement due to statement timeout

4 · A reader sweep that breaks before any batch commits
comms retention: 4 messages deleted
reader retention: did not run
reader: reader retention: Supabase POST rpc/reader_sweep_text failed: 500 nope
```

## The Storybook baselines that moved

Five committed baselines were re-rendered by this branch. One moved far enough for the snapshot gate to fail and write its three-panel diff — baseline | changed pixels | received:

![](reader-operability-image-22.png)

That is the intended change and nothing else: the overview panel gained its footer — the ghost **Re-summarise** verb on the left and the `model · prompt version · summarised-at` stamp on the right. Approved by regenerating, and here is the baseline now committed:

![](reader-operability-image-23.png)

The other four moved by less than the gate's 1% threshold, so it passed them and wrote no diff (the stale-but-passing case the storybook skill warns about). Each was deleted and regenerated — a missing baseline is always rewritten — and the regenerated PNGs are byte-identical to what the slices produced. Their new renders, approved and committed: a failed row and a refused row, whose placeholder lines now end with what the owner can still do; and the reading list, whose header gained the two status dots.

![](reader-operability-image-24.png)

![](reader-operability-image-25.png)

![](reader-operability-image-26.png)

![](reader-operability-image-27.png)

Twenty-six further baselines are NEW — no committed version to move: four `StatusDot` states, five `ReaderHeader` states, four `ReaderBanner` states, three `ArchiveView` states (populated, empty, and the read that never answered), three `PublicationsView` states, five more `PostRow` states (selected collapsed/expanded, archived-and-selected, re-summarising, refused-and-swept) and two `ReadingListView` selection states.

One baseline was dropped rather than added: `ArchiveView`'s two-hundred-row story is no longer a visual test. Two hundred rows make a crop tall enough that the single line it exists to check is a rounding error against the gate's 1% threshold, so its 2.87 MB PNG could never have failed on the thing it was guarding; `archive-view.test.tsx` pins the line instead.

## Three more states, captured in review

**The mailbox merely gone quiet.** A Gmail account that has stopped polling but refused nothing is amber, not red, and sits BELOW a stalled summariser in the banner's precedence: nothing that has already arrived is lost, and spending the alarm here would spend it on the state that needs a person. The banner leads with the mailbox's own name and how long the silence has been.

![](reader-operability-image-28.png)

**The archive read failing.** The archive's own read is the only thing on that page, so a read that never answers used to leave a blank frame that reads exactly like an empty archive. It now says so and offers the read again — the in-flight guard releases on failure, so **Try again** is a real retry rather than a no-op. Provoked by failing the browser's `GET /api/reader/posts?scope=archived` with a 500.

![](reader-operability-image-29.png)

**The pre-flight failure, read as a stall.** The tick fires, fails its credential check BEFORE it can stamp a run, and writes that error onto the otherwise-untouched seeded row. That row used to read as "the summariser has never run" — a green-ish shrug at a cron that is in fact firing every five minutes and shouting. It now reads as stalled, in the tick's own words, and the dot goes amber: `never` is the BLANK row and only that.

![](reader-operability-image-30.png)
