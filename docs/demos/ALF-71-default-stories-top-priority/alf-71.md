---
branch: claude/default-stories-top-priority-zx1jxw
---

# ALF-71 — Default new software stories to top priority

*2026-06-30T17:40:28.348Z*

A newly-captured software story should jump to the **top** of the cross-project Backlog so the owner acts on fresh work first. Previously both creation paths (`create_code_story` from the board, `enter_code_module` from the inbox gate) let `code_items.priority` default from `code_priority_seq` — `nextval` lands the story at the **bottom** (largest number = lowest rank). Migration `0012` makes both RPCs stamp an explicit top priority instead: `coalesce(min(priority), 0) - 1`, one step below every live story (the same to-top math `move_code_priority` uses).

```bash
npm run test:integration -w database 2>&1 | grep -E 'ALF-71|passed'
```

```output
✓ create_code_story lands a new story at top priority (ALF-71) — baseline=-1, new=-2 (ref=ALF-2)
✓ enter_code_module lands a gated story at top priority (ALF-71) — min before=-2, gated=-3 (ref=ALF-3)
db-integration: 7/7 passed.
```

Both real-Postgres assertions confirm a freshly-created story (`new=-2`) and a gated one (`gated=-3`) rank strictly **above** every story already in the Backlog. The frontend mirrors this optimistically: `createStory` and the gate (`convertTaskToCode` / `enterCodeModule`) stamp the optimistic card with `topStoryPriority(stories)` = `min(priority) - 1`, so it sorts to the top of the Backlog the instant it's added — before the server priority reconciles in. Pinned by the `code-store` tests "lands the optimistic card at the top of the backlog (ALF-71)".
