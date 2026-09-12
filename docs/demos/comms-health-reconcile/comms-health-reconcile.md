---
branch: claude/comms-sources-disconnected-3kzbcm
---

# Comms sources stay honest in a long-lived tab (ALF-227)

*2026-09-12T18:24:30.586Z*

The bug: leave alfred open, go elsewhere for an hour, come back to Comms — every source is amber, "the poll has stopped running", while all of them are polling fine. Nothing on the server changed; only the browser's clock moved. The Comms store is seeded once at page load and kept current by a Realtime socket, and Realtime is fire-and-forget: a socket that lapses while the tab is backgrounded or the machine asleep drops every change made in the gap and replays none of them. Account health is the surface that shows it, because it is the one thing read against a ticking clock — a `last_seen_at` frozen at the seed decays into "stale" on its own.

Captured through the live app (Playwright + the in-memory Supabase mock), with the page clock fast-forwarded an hour. Step 1 — the tab is opened: every source polled a minute ago and is green.

![](comms-health-reconcile-image-1.png)

Step 2 — an hour passes with the tab away. The pollers never stopped, but this tab heard nothing, so all three dots decay to amber and the module accuses three healthy sources of having died.

![](comms-health-reconcile-image-2.png)

Step 3, BEFORE the fix — the owner comes back to the tab. Nothing re-reads, so the accusation stands for as long as the tab stays open.

![](comms-health-reconcile-image-3.png)

Step 3, AFTER the fix — returning to the tab (and, for a machine that woke with the tab in front, the Realtime channel rejoining) re-reads GET /api/comms/health and replaces the frozen reading with the current one. Same second, same fast-forwarded clock, same seeded pollers: three green dots and no warnings.

![](comms-health-reconcile-image-4.png)

A failed re-read changes nothing and says nothing: the stale reading it would have replaced is still better than a blanked roster, and the next return tries again.

## Gated as pixels, too

The health surface now has its own committed baselines, cropped to the masthead — a whole-view snapshot is thousands of pixels tall and its mismatch threshold is wider than the 8px dot whose colour is the entire claim. Every source live: three green dots and not one sentence.

![](comms-health-reconcile-image-5.png)

Every source stale — the picture ALF-227 reports, and the one a frozen roster produces on its own: amber dots, and a different sentence per home, because the Mac's sources come back by themselves and a Worker-polled mailbox needs a person.

![](comms-health-reconcile-image-6.png)

One source erroring beside two that are fine — polls reaching the mailbox and being refused, which the surface exists to tell apart from silence at a glance.

![](comms-health-reconcile-image-7.png)

And the recovery itself is a snapshot with the real store in it: the queue story is seeded with the stale roster a lapsed tab still holds, the health endpoint is stubbed with what the pollers have actually been doing, and the play function returns the tab to the foreground. The committed baseline is the state AFTER that re-read. Reverting the store fix and re-running the gate fails exactly this one snapshot — here is its three-panel diff (baseline with the fix | changed pixels | received without it), which is the before-and-after of the bug in one image.

![](comms-health-reconcile-image-8.png)
