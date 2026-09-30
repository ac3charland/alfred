import type { Item } from '@/lib/types';

import { buildTree } from '../tree';
import { planProgress, plannedRoots } from './weekly-plan-tasks';

const PLAN = 'plan-this-week';
const OTHER_PLAN = 'plan-last-week';

let nextCreated = 0;
function item(title: string, overrides: Partial<Item> = {}): Item {
  nextCreated += 1;
  return {
    id: overrides.id ?? title,
    title,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: overrides.item_type ?? 'task',
    created_at: overrides.created_at ?? `2026-01-0${String(nextCreated)}T00:00:00Z`,
    due_date: null,
    status: overrides.status ?? 'active',
    completed_at: null,
    folder_id: null,
    dispatched_at: null,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: null,
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
    weekly_plan_id: overrides.weekly_plan_id ?? null,
  };
}

const titles = (nodes: readonly { title: string }[]) => nodes.map((node) => node.title);

describe('plannedRoots', () => {
  it("keeps only the top-level items stamped with this plan's id", () => {
    const roots = buildTree([
      item('Planned', { weekly_plan_id: PLAN }),
      item('Ordinary capture'),
      item('From last week', { weekly_plan_id: OTHER_PLAN }),
    ]);

    expect(titles(plannedRoots(roots, PLAN))).toStrictEqual(['Planned']);
  });

  it('reads in plan order — the batch stamps position 0 as the newest row', () => {
    // create_weekly_plan_items offsets created_at DOWNWARD by array index, so newest-first is
    // the order the review wrote the plan in.
    const roots = buildTree([
      item('Third', { weekly_plan_id: PLAN, created_at: '2026-07-24T12:00:00.000Z' }),
      item('First', { weekly_plan_id: PLAN, created_at: '2026-07-24T12:00:00.002Z' }),
      item('Second', { weekly_plan_id: PLAN, created_at: '2026-07-24T12:00:00.001Z' }),
    ]);

    expect(titles(plannedRoots(roots, PLAN))).toStrictEqual(['First', 'Second', 'Third']);
  });

  it('keeps completed items — a week plan shows what got done', () => {
    const roots = buildTree([
      item('Done', { weekly_plan_id: PLAN, status: 'completed' }),
      item('Open', { weekly_plan_id: PLAN }),
    ]);

    expect(titles(plannedRoots(roots, PLAN))).toStrictEqual(['Open', 'Done']);
  });

  it('carries each root with its whole subtree, including subtasks added after planning', () => {
    const roots = buildTree([
      item('Root', { weekly_plan_id: PLAN }),
      item('Planned child', { weekly_plan_id: PLAN, parent_id: 'Root' }),
      item('Added later', { parent_id: 'Root' }),
    ]);

    const [root] = plannedRoots(roots, PLAN);
    expect(titles(root?.children ?? [])).toStrictEqual(['Planned child', 'Added later']);
  });

  it('never lists a planned subtask on its own — it travels under its root', () => {
    const roots = buildTree([
      item('Root', { weekly_plan_id: PLAN }),
      item('Child', { weekly_plan_id: PLAN, parent_id: 'Root' }),
    ]);

    expect(titles(plannedRoots(roots, PLAN))).toStrictEqual(['Root']);
  });
});

describe('planProgress', () => {
  it('counts the completed tasks out of every planned task', () => {
    const roots = buildTree([
      item('Done', { weekly_plan_id: PLAN, status: 'completed' }),
      item('Open', { weekly_plan_id: PLAN }),
      item('Also open', { weekly_plan_id: PLAN }),
    ]);

    expect(planProgress(plannedRoots(roots, PLAN))).toStrictEqual({ done: 1, total: 3 });
  });

  it('leaves out rows that cannot be ticked off, so the week can reach total', () => {
    // A knowledge row (or one the classifier hasn't typed yet) has no checkbox; counting it
    // would pin the week below 100% no matter what got done.
    const roots = buildTree([
      item('Task', { weekly_plan_id: PLAN, status: 'completed' }),
      item('Note', { weekly_plan_id: PLAN, item_type: 'knowledge' }),
      item('Untyped', { weekly_plan_id: PLAN, item_type: 'unclassified' }),
    ]);

    expect(planProgress(plannedRoots(roots, PLAN))).toStrictEqual({ done: 1, total: 1 });
  });

  it('counts roots only — subtasks roll up into their parent', () => {
    const roots = buildTree([
      item('Root', { weekly_plan_id: PLAN }),
      item('Done child', { weekly_plan_id: PLAN, parent_id: 'Root', status: 'completed' }),
    ]);

    expect(planProgress(plannedRoots(roots, PLAN))).toStrictEqual({ done: 0, total: 1 });
  });
});
