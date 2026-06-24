/**
 * Runnable demo for the in-folder ordering (ALF-37 follow-up). Calls the REAL recursive sorter
 * the Folder view uses (`sortNodesByPriority` from `frontend/lib/priority.ts`) over an assembled
 * task tree and prints the ordered result, so the captured output is the production logic's own.
 * Unlike the flat By-Priority list, this ranks each node by its OWN priority at every level (no
 * subtree rollup) — subtasks are visible rows in a folder, so each sorts among its siblings.
 */
import { sortNodesByPriority } from '@/lib/priority';
import type { ItemNode } from '@/lib/tree';
import type { Item } from '@/lib/types';

function node(id: string, fields: Partial<Item>, children: ItemNode[] = []): ItemNode {
  return {
    id,
    title: id,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: 'task',
    created_at: fields.created_at ?? '2026-06-01T00:00:00Z',
    due_date: fields.due_date ?? null,
    status: 'active',
    completed_at: null,
    folder_id: 'work',
    parent_id: fields.parent_id ?? null,
    occurrence_index: null,
    priority: fields.priority ?? null,
    recurrence: null,
    recurrence_series_id: null,
    children,
  };
}

const folder: ItemNode[] = [
  node('Tidy the desk', { priority: 'low' }),
  node('Reply to the client', { priority: 'high', due_date: '2026-06-10' }),
  node('Plan the sprint', { priority: 'medium' }, [
    node('Write the agenda', { priority: 'low', parent_id: 'Plan the sprint' }),
    node('Book the room', { priority: 'high', parent_id: 'Plan the sprint' }),
  ]),
  node('Someday idea', {}),
];

console.log('Folder "Work" — ranked by priority at every level (own key, no rollup):');
for (const top of sortNodesByPriority(folder)) {
  console.log(`  ${top.title.padEnd(22)} [${(top.priority ?? '—').padEnd(6)}]`);
  for (const child of top.children) {
    console.log(`    └ ${child.title.padEnd(18)} [${(child.priority ?? '—').padEnd(6)}]`);
  }
}
