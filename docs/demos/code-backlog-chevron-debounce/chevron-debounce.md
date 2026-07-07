---
branch: claude/alfred-debounce-priority-reorder-tniigg
---

# Rapid backlog chevron clicks debounce to one reorder call

*2026-07-07T21:54:36.191Z*

ALF-111: the Backlog's chevron reorder/move buttons (`backlog-row.tsx`) reorder the list INSTANTLY on every click — a rapid burst steps the row through each swap live, with no delay. Only the NETWORK sync is debounced (200ms, trailing edge): a burst of clicks queues its swaps locally, and the queue flushes to the server as one batch once the clicks settle, instead of one overlapping request per click. Reorder swaps queue and replay in click order (`commitReorderBatch`); a top/bottom jump only ever needs the LATEST direction (`commitMove`), since jumping is idempotent. The full correctness story — queued replay, mid-burst rollback, and the LIVE-neighbour behavior (a burst that visually cancels out sends the matching pair of no-op swaps) — is covered by `backlog-row.test.tsx`, `code-store.test.tsx`, and `e2e/code-backlog.spec.ts`; this doc's GIF shows the one thing only a recording can: the on-screen reorder happening instantly.

![Three rapid Up clicks on the bottom row (ALF-6) — the network is deliberately slowed 1.5s, but the row already steps to the top on screen well before any response lands](chevron-debounce-video-1.gif)
