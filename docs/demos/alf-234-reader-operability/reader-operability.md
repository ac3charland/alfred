---
branch: claude/lucid-gates-jug4gp
---

# Reader: publications, health, re-summarise, archive, keyboard and retention

*2026-09-18T21:58:43.471Z*

The Reader module was a pipe with a list on the end of it: mail arrived, a Worker summarised it, and everything else — who gets claimed, whether the summariser is alive, re-running a summary, finding a post you put away — was a SQL query or a `wrangler tail`. This branch makes all of that reachable from the app, and bounds what the pipe stores.

Every screenshot below is the running app, driven through the Playwright mock backend. The retention evidence is a real PostgreSQL cluster; the Worker evidence is the Worker's own `scheduled` handler with a stubbed `fetch`.

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

The header carries a summariser dot and a Gmail (personal) dot, each with its state in the accessible label, and a sentence beneath any state that is not live. Above them, at most ONE banner renders, in a fixed precedence: Gmail dead → summariser stalled → daily ceiling reached.

**Gmail dead wins over everything.** This seed has BOTH a refusing mailbox and a spent ceiling; the red banner is the one that renders, because nothing new is arriving to summarise or to spend the budget on. The Gmail dot goes red and carries how long it has been silent; the summariser dot stays green, because the summariser is fine.

![](reader-operability-image-7.png)

**Summariser stalled** — the tick recorded a failure more recently than a success. The banner is dated from when summarising actually stopped, not from when it was noticed, and quotes the tick's own words.

![](reader-operability-image-8.png)

**Daily ceiling reached** — amber and informational: the cap is read off the health row the tick stamps (30), and the four claimed posts waiting are counted as waiting for tomorrow rather than reported as a stall. Both dots stay green, because nothing is broken.

![](reader-operability-image-9.png)

**Never ran** — no health row at all. An amber dot and a sentence, and deliberately no banner: before the first tick there is nothing to be stalled from, and the fix is the Worker's cron rather than anything in the app.

![](reader-operability-image-10.png)

## Re-summarise — one verb, and the two answers it can be refused with

One list, four states: a done row, a failed row with **Retry summary**, a refused row whose text the sweep took (an italic line says why there is no verb), and a failed row whose body never made it in at all.

![](reader-operability-image-11.png)

Under a done row's overview: the new stamp line — model, prompt version, summarised-at — beside the ghost **Re-summarise**. The stamp is what makes a re-run visible: without it "I re-ran it" and "nothing happened" look the same.

![](reader-operability-image-12.png)

Re-summarising sets the row pending with its attempts reset and **keeps the summary it already has** — gist and overview both, at the pending marker's opacity — so the owner is never shown a judgment that has not happened yet. The verb disappears while the row is queued.

![](reader-operability-image-13.png)

A row whose body never made it in still OFFERS the verb (the list payload deliberately carries no text), so the route is what knows: it reads the row first and refuses with the reason, in its own words, which the store toasts verbatim. A swept post gets the other sentence, naming the date.

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

The E2E mock has no `reader_sweep_text`, so this runs against the database package's throwaway cluster with every migration applied exactly as production applies them. Three posts are inserted either side of the window and the function is called the way the Worker loops it — one batch per call, until a batch returns 0 (`p_limit` is 1 here so the batching is visible). The 91- and 120-day-old posts lose their text and gain `text_swept_at`; the 89-day-old one is untouched; every summary survives.

```bash
node docs/demos/alf-234-reader-operability/retention-sweep.mjs
```

```output

Before the sweep:
  A · 91 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  B · 89 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  C · 120 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true

reader_sweep_text(90, 1), called until it returns 0:
  call 1 → 1 row(s) swept
  call 2 → 1 row(s) swept
  call 3 → 0 row(s) swept

After the sweep:
  A · 91 days old  text=   0 chars  swept=true   title/gist/overview/summarized_at kept=true
  B · 89 days old  text=1160 chars  swept=false  title/gist/overview/summarized_at kept=true
  C · 120 days old  text=   0 chars  swept=true   title/gist/overview/summarized_at kept=true
```

## The Worker — the ceiling stamp, and the daily sweep's own log lines

The Worker is headless: its surfaces are the calls it makes and the lines it logs. This drives the REAL modules (`reader/health.ts`, and the entrypoint's own `scheduled` handler) with `fetch` stubbed, so both are captured rather than restated. Note the health PATCHes: the run-start write carries the cap the tick will enforce, and the terminal write carries the cap AND what the UTC day has spent — which is exactly what lets the ceiling banner say "(30)" without the frontend knowing a deploy var. Then the daily cron: the comms sweep, then the reader's, each logging its own line; and when the reader's RPC is refused, the comms sweep beside it still ran and the reader's failure is reported rather than rethrown.

```bash
node docs/demos/alf-234-reader-operability/worker-evidence.mjs
```

```output
1 · The ceiling the tick stamps on reader_health
  PATCH /rest/v1/reader_health
    {"daily_cap":30,"last_run_at":"2026-09-18T09:17:00.000Z"}
  PATCH /rest/v1/reader_health
    {"calls_day":"2026-09-18","calls_today":30,"daily_cap":30,"last_success_at":"2026-09-18T09:17:00.000Z"}

2 · The daily retention cron (17 9 * * *): comms, then the reader
comms retention: 12 messages deleted
reader retention: 3 posts swept
  POST /rest/v1/rpc/comm_sweep_expired  {"p_days":60}
  POST /rest/v1/rpc/reader_sweep_text  {"p_days":90,"p_limit":5000}
  POST /rest/v1/rpc/reader_sweep_text  {"p_days":90,"p_limit":5000}
  POST /rest/v1/rpc/reader_sweep_text  {"p_days":90,"p_limit":5000}

3 · The reader sweep failing does not take the comms sweep with it
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

Nineteen further baselines are NEW — no committed version to move: the three `StatusDot` states, five `ReaderHeader` states, three `ReaderBanner` states, three `ArchiveView` states, three `PublicationsView` states, four more `PostRow` states (selected collapsed/expanded, archived-and-selected, re-summarising, refused-and-swept) and two `ReadingListView` selection states.
