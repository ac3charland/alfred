import { pinClock } from '@/lib/pin-clock';
import type { Item } from '@/lib/types';

import { buildTree } from '../tree';
import { rankDueToday } from './due-today';

// Every fixture's due date is written relative to this instant, so the suite reads the same
// "today" whenever it runs.
pinClock('2026-09-06T09:00:00');

let nextCreated = 0;
function task(title: string, overrides: Partial<Item> = {}): Item {
  nextCreated += 1;
  return {
    id: overrides.id ?? title,
    title,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: overrides.item_type ?? 'task',
    created_at: overrides.created_at ?? `2026-01-0${String(nextCreated)}T00:00:00Z`,
    due_date: overrides.due_date ?? null,
    status: overrides.status ?? 'active',
    completed_at: null,
    folder_id: null,
    dispatched_at: null,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: overrides.priority ?? null,
    recurrence: null,
    recurrence_series_id: null,
    intended_project_id: null,
    intended_epic_id: null,
    sort_order: 0,
    classified_at: null,
    classified_provider: null,
    classified_model: null,
    classified_prompt_version: null,
    classified_guess: null,
    classify_attempts: 0,
    weekly_plan_id: null,
  };
}

/** Rank a flat item list the way the Today view does, and read back the titles in order. */
function ranked(items: Item[], showCompleted = false): string[] {
  return rankDueToday(buildTree(items), showCompleted).map((node) => node.title);
}

describe('rankDueToday', () => {
  describe('which tasks it lists', () => {
    it('keeps a task due today and one already overdue, and drops future + undated ones', () => {
      expect(
        ranked([
          task('Due today', { due_date: '2026-09-06' }),
          task('Overdue', { due_date: '2026-09-01' }),
          task('Due tomorrow', { due_date: '2026-09-07' }),
          task('No due date', { due_date: null }),
        ]),
      ).toEqual(['Overdue', 'Due today']);
    });

    it('lists only top-level tasks — a due subtask never becomes its own row', () => {
      expect(
        ranked([
          task('Parent', { id: 'p', due_date: null }),
          task('Due child', { id: 'c', parent_id: 'p', due_date: '2026-09-06' }),
        ]),
      ).toEqual(['Parent']);
    });

    it('floats an undated parent in on an active descendant due today, at any depth', () => {
      expect(
        ranked([
          task('Grandparent', { id: 'g' }),
          task('Parent', { id: 'p', parent_id: 'g' }),
          task('Grandchild', { id: 'c', parent_id: 'p', due_date: '2026-09-06' }),
        ]),
      ).toEqual(['Grandparent']);
    });

    it('ignores a COMPLETED descendant due date — a finished subtask is not still due', () => {
      expect(
        ranked([
          task('Parent', { id: 'p' }),
          task('Done child', {
            id: 'c',
            parent_id: 'p',
            due_date: '2026-09-01',
            status: 'completed',
          }),
        ]),
      ).toEqual([]);
    });

    it('hides a completed top-level task unless showCompleted is on', () => {
      const items = [task('Done today', { due_date: '2026-09-06', status: 'completed' })];

      expect(ranked(items)).toEqual([]);
      expect(ranked(items, true)).toEqual(['Done today']);
    });
  });

  describe('the order it lists them in', () => {
    it('puts the most overdue first, then today', () => {
      expect(
        ranked([
          task('Today', { due_date: '2026-09-06' }),
          task('Two days late', { due_date: '2026-09-04' }),
          task('A week late', { due_date: '2026-08-30' }),
        ]),
      ).toEqual(['A week late', 'Two days late', 'Today']);
    });

    it('breaks a same-date tie by priority, not the other way round', () => {
      expect(
        ranked([
          // The high-priority task is due LATER, so urgency must still put the overdue one first.
          task('Low but overdue', { due_date: '2026-09-01', priority: 'low' }),
          task('High but due today', { due_date: '2026-09-06', priority: 'high' }),
          task('Unprioritised, overdue', { due_date: '2026-09-01', priority: null }),
        ]),
      ).toEqual(['Low but overdue', 'Unprioritised, overdue', 'High but due today']);
    });

    it('ranks a rolled-up parent by the earliest active due date in its subtree', () => {
      expect(
        ranked([
          task('Own date today', { id: 'a', due_date: '2026-09-06' }),
          task('Child is late', { id: 'b' }),
          task('Late child', { id: 'bc', parent_id: 'b', due_date: '2026-08-30' }),
        ]),
      ).toEqual(['Child is late', 'Own date today']);
    });

    it('falls back on created_at when date and priority both tie', () => {
      expect(
        ranked([
          task('Second', { due_date: '2026-09-06', created_at: '2026-02-02T00:00:00Z' }),
          task('First', { due_date: '2026-09-06', created_at: '2026-02-01T00:00:00Z' }),
        ]),
      ).toEqual(['First', 'Second']);
    });
  });
});
