---
branch: claude/refetch-ticket-statuses-31flil
---

# ALF-69 — Refetch ticket statuses on project/backlog navigation

*2026-07-01T04:47:46.368Z*

The Code store is seeded **once** at the shared shell layout, so switching between a project board and the Backlog is an instant client-side URL change that never refetches. Statuses stay live only via a realtime `code_items` subscription — which can silently drop events when the connection is stale or the tab is backgrounded. ALF-69 adds a defensive pull: on every navigation to a board or the Backlog (keyed on `pathname` in `CodeView`, which also covers entry to the module), `refreshStatuses` refetches `GET /api/code` and reconciles each held story's status.

The reconcile projects every fetched story down to just its **status** fields via the shared `codeStoryStatusPatch` (`factory_state`, `lane`, `blocked_reason`) and patches the matching store row by `item_id`. The script below drives a stale in-store status through that exact production helper: the store's story moved out of band to `ready_for_review` on the server, and after the patch the store reflects it — while the local `title` and `priority` are left untouched (the projection omits them, so a refetch never clobbers unrelated fields).

```bash
node docs/demos/ALF-69/reconcile.ts 2>/dev/null
```

```output
before: in_development | title: Refetch ticket statuses | priority: 3
patch:  {"factory_state":"ready_for_review","lane":"human","blocked_reason":null}
after:  ready_for_review | title: Refetch ticket statuses | priority: 3
```

`before` shows the stale status this tab held; `patch` is the exact projection `refreshStatuses` dispatches per story; `after` shows the store reconciled to the server's `ready_for_review` — with `title`/`priority` unchanged. The behaviour is pinned by tests too: `codeStoryStatusPatch` (the projection), the store's `refreshStatuses` action (patches statuses, ignores absent stories, swallows a failed fetch), and `CodeView` (refetches on module entry and every project ↔ backlog navigation, but not on an unchanged-path re-render).
