---
branch: claude/vigilant-mayer-ktztkz
---

# Jumping to a subtask opens its parents and rings it (ALF-361)

*2026-11-20T02:51:37.027Z*

**Bug:** jumping to a subtask (global search, or a nested row in By Priority) switched to the right folder, but the subtask's ancestors stayed collapsed, so its row (and the teal 'you are here' ring) was hidden inside a 0-height, aria-hidden subtask list. **Fix:** a shared `useNavigateToTask` hook opens every ancestor's subtask tree in the layout-level expansion store before the jump. Shots were captured through the Playwright mock-backend harness against the live app; 'before' frames were taken with the two call-site changes reverted.

## Journey 1: global search, two levels deep

Seed: folder **Home** › *Plan the offsite* › *Book the venue* › **Firewall the guest wifi**. Search for 'firewall':

![](search-subtask-reveal-image-1.png)

**Before** (press Enter): the jump lands on Home with *Plan the offsite* collapsed. The subtask and its ring can't be seen.

![](search-subtask-reveal-image-2.png)

**After:** both ancestors open and the subtask row is ringed.

![](search-subtask-reveal-image-3.png)

## Journey 2: By Priority → a nested row

Same bug, same cause: a By-Priority subtask's link jumps into its folder. Expand *Plan the offsite* in By Priority, then click the subtask:

![](search-subtask-reveal-image-4.png)

**Before:** the folder shows the parent collapsed.

![](search-subtask-reveal-image-5.png)

**After:** the parent is open and the subtask is ringed.

![](search-subtask-reveal-image-6.png)
