---
branch: claude/alf-316-review-filters-ctami1
---

# Needs human action: filter by status and by project

*2026-10-02T18:40:13.219Z*

Setup: two projects (**Alfred**, **Relay**) with five stories in the three human-review states, interleaved in the global ranking, plus one `in_development` story the view never lists. Every shot is the live app against the e2e Supabase mock.

### 1. At rest — both dropdowns in the header, no counts, the whole cross-project queue

![](needs-human-action-filters-image-1.png)

### 2. Filter by status offers only the three human-review states (all checked at rest). Unchecking **In Refinement**…

![](needs-human-action-filters-image-2.png)

…drops both spec reviews; the trigger counts the narrowed selection.

![](needs-human-action-filters-image-3.png)

### 3. Filter by project — nothing checked at rest (= every project). Picking **Relay** (status restored)…

![](needs-human-action-filters-image-4.png)

…narrows to Relay's two stories, still in global priority order.

![](needs-human-action-filters-image-5.png)

### 4. The selection is this view's own: the Backlog is untouched by the Relay pick (no count, all six outstanding stories)…

![](needs-human-action-filters-image-6.png)

…and coming back to Needs human action restores the Relay pick (SPA navigation via the sidebar).

![](needs-human-action-filters-image-7.png)

### 5. When the filters hide every waiting story, the empty state blames the filters instead of claiming nothing needs attention

![](needs-human-action-filters-image-8.png)
