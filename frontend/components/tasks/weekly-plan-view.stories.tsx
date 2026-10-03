import type { Meta, StoryObj } from '@storybook/nextjs';

import type { Folder, Item, WeeklyPlan } from '@/lib/types';

import { WeeklyPlanView } from './weekly-plan-view';

/**
 * A stand-in for the real generated document: self-contained, with its own tokens and its own
 * `prefers-color-scheme` block, so the frame shows that the plan paints itself rather than
 * inheriting the app's styling.
 */
const planHtml = (week: string, theme: string): string => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${week}</title><style>
  :root { --bg: #ffffff; --fg: #1b1f24; --accent: #0d7d7d; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14181d; --fg: #e6eaef; --accent: #46c9c9; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); max-width: 780px;
         padding: 2rem; font: 16px/1.6 -apple-system, sans-serif; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .theme { color: var(--accent); font-weight: 600; }
</style></head><body>
  <h1>${week}</h1>
  <p class="theme">${theme}</p>
  <h2>Win conditions</h2>
  <ul><li>Ship the weekly plan view</li><li>Clear the inbox to zero</li></ul>
  <h2>Success criteria</h2>
  <label><input type="checkbox" /> Plan renders in alfred</label>
</body></html>`;

const LATEST: WeeklyPlan = {
  id: '11111111-1111-4111-8111-111111111111',
  html: planHtml('Week 12: Jul 18 – Jul 25, 2026', 'Theme: finish what is started'),
  uploaded_at: '2026-07-24T12:00:00Z',
};
const OLDER: WeeklyPlan = {
  id: '22222222-2222-4222-8222-222222222222',
  html: planHtml('Week 11: Jul 11 – Jul 18, 2026', 'Theme: clear the decks'),
  uploaded_at: '2026-07-17T12:00:00Z',
};

const summary = (plan: WeeklyPlan) => ({ id: plan.id, uploaded_at: plan.uploaded_at });

const WORK: Folder = {
  id: 'folder-work',
  name: 'Work',
  created_at: '2026-07-01T00:00:00Z',
  sort_order: 1,
  description: null,
};

/** A row the review created against `plan`. `order` is its position in the plan (0 = first). */
function planned(title: string, plan: WeeklyPlan, order: number, overrides: Partial<Item> = {}) {
  return {
    id: `${plan.id}-${String(order)}-${title}`,
    title,
    notes: null,
    source_url: null,
    raw_capture: title,
    item_type: 'task',
    status: 'active',
    due_date: null,
    due_time: null,
    completed_at: null,
    folder_id: null,
    dispatched_at: null,
    parent_id: null,
    intended_project_id: null,
    intended_epic_id: null,
    occurrence_index: null,
    priority: null,
    recurrence: null,
    recurrence_series_id: null,
    sort_order: order,
    classified_at: null,
    classified_provider: null,
    classified_model: null,
    classified_prompt_version: null,
    classified_guess: null,
    classify_attempts: 0,
    // The batch stamps position 0 as the NEWEST row, so plan order is newest-first.
    created_at: new Date(Date.parse(plan.uploaded_at) - order).toISOString(),
    weekly_plan_id: plan.id,
    ...overrides,
  } satisfies Item;
}

const LAUNCH = planned('Ship the weekly plan view', LATEST, 0, {
  folder_id: WORK.id,
  dispatched_at: '2026-07-24T13:00:00Z',
  priority: 'high',
});

const PLANNED_TASKS: Item[] = [
  LAUNCH,
  planned('Write the demo doc', LATEST, 0, { parent_id: LAUNCH.id }),
  planned('Open the PR', LATEST, 1, { parent_id: LAUNCH.id }),
  planned('Clear the inbox to zero', LATEST, 1, {
    status: 'completed',
    completed_at: '2026-07-25T09:00:00Z',
  }),
  planned('Book the dentist', LATEST, 2, { due_date: '2026-07-27' }),
  planned('Read up on sandboxed iframes', LATEST, 3, { item_type: 'knowledge' }),
  planned('Last week’s leftover', OLDER, 0),
];

const meta = {
  title: 'Tasks/WeeklyPlanView',
  component: WeeklyPlanView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WeeklyPlanView>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Several weeks archived: the picker lists them newest-first, labelled by upload date. Under the
 * document preview sit the tasks this week's review created — a finished one struck through, a
 * parent with subtasks. The knowledge row it also created stays out of the list.
 */
export const Populated: Story = {
  parameters: {
    store: {
      folders: [WORK],
      tasks: PLANNED_TASKS,
      weeklyPlans: { index: [summary(LATEST), summary(OLDER)], latest: LATEST },
    },
  },
};

/**
 * A single upload with nothing created against it yet: no picker (nothing to pick between), and
 * the task list's empty state explains itself.
 */
export const SinglePlan: Story = {
  parameters: { store: { weeklyPlans: { index: [summary(LATEST)], latest: LATEST } } },
};

/** Nothing uploaded yet: the empty state carries the upload instruction, not an error. */
export const Empty: Story = {
  parameters: { store: { weeklyPlans: { index: [] } } },
};
