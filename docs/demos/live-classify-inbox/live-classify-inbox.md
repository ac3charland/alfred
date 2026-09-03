---
branch: claude/live-update-inbox-llm-classify-zdwdsu
---

# The Inbox updates itself as the classifier judges its rows

*2026-09-03T18:12:41.971Z*

ALF-196. The classifier sweep Worker fills an untouched capture's labels a minute or two after it lands — the one writer the owner never pressed. The tasks store seeds once, so until now those labels only appeared on the next hard reload: the row you were looking at while the sweep ran stayed blank and stale.

Now `items` is in the `supabase_realtime` publication and `TasksProvider` subscribes to it. The clip below drives two writes down that stream, against the real app: first an ordinary edit that no model produced, then the sweep's verdict.

![an inbox row taking a classifier verdict live](live-classify-inbox-video-1.gif)

Watch the row, not the page. At ~1s a NON-verdict update arrives carrying the title "A stale echo of somebody else's edit" — the row ignores it, because no model produced it and a payload like that can be older than an edit this tab has in flight. At ~2s the sweep's verdict arrives: the row picks up its checkbox, its Task badge, the Health folder it would land in, a due date and a high-priority chevron, the provenance mark flips from a dashed circle to the classifier's sparkle, and the whole row rings for a beat and settles. It never leaves the Inbox — a label is not a move.

The publication is the other half — without it the stream carries nothing:

```bash
tail -1 database/migrations/0031_realtime_items.sql
```

```output
alter publication supabase_realtime add table items;
```

And the rule for what may touch the store, which is a pure function rather than branches inside a subscription callback:

```bash
sed -n '/^export function classifierVerdictPatch/,/^  return {/p' frontend/lib/tasks/classification.ts
```

```output
export function classifierVerdictPatch(
  held: Pick<Item, 'classified_at'> | undefined,
  row: ClassifiedRow,
): Partial<Item> | null {
  if (row.classified_provider === null) return null;
  if (held?.classified_at !== null) return null;
  return {
```
