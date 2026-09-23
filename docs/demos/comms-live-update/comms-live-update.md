---
branch: claude/comes-module-live-update-c9bx5a
---

# ALF-258: Comms live-updates again (and says when it last heard from a source)

*2026-09-22T17:52:18.623Z*

**Root cause.** Every store's realtime channel called `.subscribe()` straight from a mount effect. A channel's join payload is frozen at that moment, before the browser Supabase client has read the session, so the join carried no `access_token` and the server subscribed it as `anon`. RLS policies are `to authenticated`, so an anon channel is delivered nothing, silently. supabase-js re-sends a token to a joined channel only when it *changes*, and by the time the join completed it had already stored this one, so the tab stayed anon until the JWT next rotated (up to an hour). Production confirmed it: `realtime.subscription` held a full set of `claims_role = anon` rows for an open tab. A hard refresh re-rolled the race, which is why it looked like the fix. The Tasks (`items`) and Code (`code_items`, `epics`) channels join through `joinWhenAuthenticated` (`frontend/lib/supabase/realtime.ts`), which awaits `realtime.setAuth()` first — that fix stands. **Comms no longer has a Realtime channel to fix**: its four tables are written by a Worker or the Mac daemon on a 1–3 minute cadence, so this branch replaces its subscription with a poll of `GET /api/comms/snapshot`, and the anon-join regression now lives on the Tasks/Code channels instead.

## Recovering whatever a missed poll dropped

The Comms view polls its whole snapshot on a timer while the tab is visible, and re-reads sooner whenever it may have missed something: the tab returning to the front, a bfcache-restored page, coming back online, or a failed write. So the view catches up on its own from a gap — a tab in the background, a laptop asleep, a phone that suspended the app, or the moment between the server render and the first poll — without needing a live connection to have been open the whole time. The read is small because the view only holds what it shows: everything above FYI in full, the first 50 shelf rows, and the shelf and Reader totals as counts.

**A message written while the tab was away, with no push for it.** The page opens with 60 FYI rows and nothing owed. Then a new ASAP message is written straight to the backend, standing in for the change a missed poll would otherwise catch on its own. The tab comes back to the front:

![](comms-live-update-image-5.png)

![](comms-live-update-image-6.png)

**When it can't re-read, it says so.** The re-read is blocked, standing in for being offline. The queue keeps what it had, and a line above everything says the view may be behind, dated to the last successful read. It clears on the next one that lands.

![](comms-live-update-image-7.png)

**The shelf pages from the server.** The count says 60 while the view holds only 50 rows. "Show more (10 older)" is the same snapshot read asked for 100, and afterwards all 60 are on screen, down to Receipt 60:

![](comms-live-update-image-8.png)
