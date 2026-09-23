import type { Meta, StoryObj } from '@storybook/nextjs';

import { stubEndpoint } from '@/lib/storybook/stub-fetch';
import type { WeeklyPlanItemNode, WeeklyPlanItemsPayload } from '@/lib/weekly-plan-items/payload';

import { WeeklyPlanItems } from './weekly-plan-items';

const PLAN = { id: '11111111-1111-4111-8111-111111111111', uploaded_at: '2026-07-24T12:00:00Z' };

/** A node with every field the row doesn't care about already at a sane default. */
function node(
  overrides: Partial<WeeklyPlanItemNode> & Pick<WeeklyPlanItemNode, 'id' | 'title'>,
): WeeklyPlanItemNode {
  return {
    item_type: 'task',
    notes: null,
    due_date: null,
    priority: null,
    state: 'active',
    done: false,
    done_at: null,
    created_at: '2026-07-24T09:00:00Z',
    folder: null,
    in_inbox: true,
    code: null,
    children: [],
    ...overrides,
  };
}

const COHORT: WeeklyPlanItemsPayload = {
  plan: PLAN,
  counts: { total: 6, done: 2, open: 3, abandoned: 1, untriaged: 4 },
  items: [
    node({
      id: 'root-1',
      title: 'Ship the motivic harness spike',
      due_date: '2026-07-25',
      priority: 'high',
      done: true,
      state: 'completed',
      children: [
        node({
          id: 'child-1',
          title: "Re-read last week's findings doc",
          done: true,
          state: 'completed',
        }),
        node({ id: 'child-2', title: 'Write the harness skeleton', due_date: '2026-07-25' }),
      ],
    }),
    node({
      id: 'root-2',
      title: 'Per-voice mute in the mixer',
      item_type: 'code',
      state: 'ready_for_review',
      code: { ref: 'RPL-142', lane: 'human' },
    }),
    node({
      id: 'root-3',
      title: 'Rewrite the preset browser',
      item_type: 'code',
      state: 'abandoned',
      code: { ref: 'RPL-144', lane: 'human' },
    }),
    node({
      id: 'root-4',
      title: "Decide what Q4's third rock actually is",
      item_type: 'unclassified',
    }),
  ],
};

const EMPTY_COHORT: WeeklyPlanItemsPayload = {
  plan: PLAN,
  counts: { total: 0, done: 0, open: 0, abandoned: 0, untriaged: 0 },
  items: [],
};

const meta = {
  title: 'Tasks/WeeklyPlanItems',
  component: WeeklyPlanItems,
  args: { planId: PLAN.id },
  decorators: [
    (Story) => (
      <div className="w-[560px] bg-background p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WeeklyPlanItems>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A week worked to varying degrees: a completed task with a done subtask and an open one, a
 * story in review, an abandoned story, and an unclassified capture never touched.
 */
export const Ready: Story = {
  decorators: [stubEndpoint(200, COHORT)],
};

/** A freshly-posted plan nothing has been created against yet — not an error. */
export const Empty: Story = {
  decorators: [stubEndpoint(200, EMPTY_COHORT)],
};

/** In flight: the skeleton reserves the section's place while the cohort loads. */
export const Loading: Story = {
  decorators: [stubEndpoint(200)],
};

/** The read failed — a muted note, no retry loop, the plan document above stays usable. */
export const Failed: Story = {
  decorators: [stubEndpoint(500, { error: 'Internal error' })],
};
