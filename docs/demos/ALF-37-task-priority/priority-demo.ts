/**
 * Runnable demo for ALF-37 — task priority ranking. Calls the REAL ranking function the
 * By-Priority view uses (`rankByPriority` from `frontend/lib/priority.ts`), so the output below
 * is the production logic's own, not a re-implementation. Bundled with esbuild (which resolves
 * the `@/` alias from the frontend tsconfig) and run with node — see the exec block in the doc.
 */
import { PRIORITY_OPTIONS, priorityRank, rankByPriority } from '@/lib/priority';
import type { Item } from '@/lib/types';

/** Build a minimal Item; only the fields the ranking reads matter here. */
function task(id: string, fields: Partial<Item>): Item {
  return {
    id,
    title: fields.title ?? id,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: 'task',
    created_at: fields.created_at ?? '2026-06-01T00:00:00Z',
    due_date: fields.due_date ?? null,
    status: fields.status ?? 'active',
    completed_at: null,
    folder_id: fields.folder_id ?? null,
    parent_id: fields.parent_id ?? null,
    occurrence_index: null,
    priority: fields.priority ?? null,
    recurrence: null,
    recurrence_series_id: null,
  };
}

function show(heading: string, items: Item[]): void {
  console.log(`\n${heading}`);
  for (const t of rankByPriority(items, false)) {
    const where = t.folder_id ?? 'Inbox';
    const level = t.priority ?? '—';
    const due = t.due_date ?? 'no due date';
    console.log(`  ${t.title.padEnd(26)} [${level.padEnd(6)}] due ${due.padEnd(12)} (${where})`);
  }
}

console.log('Level set & rank (lower = higher in the list):');
for (const option of PRIORITY_OPTIONS) {
  console.log(`  ${option.label.padEnd(8)} rank ${String(priorityRank(option.value))}`);
}
console.log(`  ${'(none)'.padEnd(8)} rank ${String(priorityRank(null))}`);

// 1) Level first, due date as the within-level tiebreaker (earliest / most overdue first).
show('Ranked by level, due date breaks ties within a level:', [
  task('Tidy bookmarks', { priority: 'low', folder_id: 'Inbox' }),
  task('Draft Q3 planning doc', { priority: 'medium', folder_id: 'Work' }),
  task('Reply to landlord', { priority: 'high', due_date: '2026-06-10', folder_id: 'Home' }),
  task('Ship the priority migration', { priority: 'high', due_date: '2026-06-25' }),
  task('Someday: learn the cello', {}),
]);

// 2) Subtree rollup — a Low parent hiding a High, overdue ACTIVE subtask floats above a plain
//    Medium task; the SAME parent stays Low when that subtask is already completed.
show('Subtree rollup — active High subtask lifts its Low parent above a Medium task:', [
  task('Plain medium task', { priority: 'medium' }),
  task('Low parent (active urgent child)', { priority: 'low' }),
  task('Fix prod outage', { parent_id: 'Low parent (active urgent child)', priority: 'high', due_date: '2026-06-01' }),
]);

show('…but a COMPLETED High subtask does not lift the parent — it stays Low, below Medium:', [
  task('Plain medium task', { priority: 'medium' }),
  task('Low parent (completed child)', { priority: 'low' }),
  task('Old done task', { parent_id: 'Low parent (completed child)', priority: 'high', status: 'completed' }),
]);
