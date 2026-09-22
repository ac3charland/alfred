---
branch: claude/comes-module-live-update-c9bx5a
---

# ALF-258: Comms live-updates again (and says when it last heard from a source)

*2026-09-22T17:52:18.623Z*

**Root cause.** Every store's realtime channel called `.subscribe()` straight from a mount effect. A channel's join payload is frozen at that moment, before the browser Supabase client has read the session, so the join carried no `access_token` and the server subscribed it as `anon`. Every Comms table's RLS policy is `to authenticated`, so an anon channel is delivered nothing, silently. supabase-js re-sends a token to a joined channel only when it *changes*, and by the time the join completed it had already stored this one, so the tab stayed anon until the JWT next rotated (up to an hour). Production confirmed it: `realtime.subscription` held a full set of `claims_role = anon` rows for an open tab. A hard refresh re-rolled the race, which is why it looked like the fix. The same race hit the Tasks (`items`) and Code (`code_items`, `epics`) channels, so all three now join through `joinWhenAuthenticated` (`frontend/lib/supabase/realtime.ts`), which awaits `realtime.setAuth()` first.

**Before the fix.** The live app runs on the Playwright mock backend, whose fake realtime socket now drops pushes to a channel that joined without a token, as RLS does. The page has just received a classifier re-tier (FYI → Today) and a fresh poll on `personal`, and neither lands: Today is empty and the source still reads 2h stale.

![](comms-live-update-image-1.png)

**After the fix: the page as it opens.** The row is on the FYI shelf, and the new last-ping line under the dots says which source checked in last and when.

![](comms-live-update-image-2.png)

**After the fix: the same two pushes, no reload.** The re-tiered row moves into Today, the dot turns green, and the line reads "Last ping just now · personal".

![](comms-live-update-image-3.png)

**The Comms header baseline moved on purpose.** Below is the visual-snapshot gate's diff (old, diff, new): the dots lift slightly and the last-ping line appears beneath them. The same shift moved the queue-view stories' baselines, all approved in this branch.

![](comms-live-update-image-4.png)
