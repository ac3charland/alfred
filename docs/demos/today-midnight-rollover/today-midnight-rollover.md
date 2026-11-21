---
branch: claude/modest-mendel-c9sob0
---

# Today picks up the new day's tasks at midnight

*2026-11-21T17:18:20.029Z*

ALF-369: the Today view memoised its list on the task rows alone, while "today" was read inside the memo. A tab left open overnight kept showing yesterday's list until some edit (e.g. resetting a due date) re-derived it, which is why weekly-plan tasks for the new day seemed to be missing. The fix passes the day in from the ticking `useNow` clock.

Setup for every shot below: three tasks due Fri Nov 20, Sat Nov 21 and Sun Nov 22, the browser clock pinned (Playwright `page.clock`) to **Fri 23:58**, then run forward 3 minutes to **Sat 00:01**, with no edit and no reload.

## Before the fix

At Fri 23:58 only Friday's task is listed, which is correct.

![](today-midnight-rollover-image-1.png)

At Sat 00:01 the list is unchanged: "Prep the weekly review" (due Saturday) is missing, and the invoice chip still says *Today*. That is the bug.

![](today-midnight-rollover-image-2.png)

## After the fix

Same seed, same clock. At Fri 23:58 the list is identical to before.

![](today-midnight-rollover-image-3.png)

At Sat 00:01 Saturday's task appears and the invoice is now *Yesterday*, all on its own.

![](today-midnight-rollover-image-4.png)
