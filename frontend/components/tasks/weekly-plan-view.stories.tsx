import type { Meta, StoryObj } from '@storybook/nextjs';

import { stubEndpoint } from '@/lib/storybook/stub-fetch';
import type { WeeklyPlan } from '@/lib/types';
import type { WeeklyPlanItemsPayload } from '@/lib/weekly-plan-items/payload';

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

/** What the review created against the latest plan — the section rendered underneath it. */
const ITEMS: WeeklyPlanItemsPayload = {
  plan: summary(LATEST),
  counts: { total: 3, done: 1, open: 2, abandoned: 0, untriaged: 2 },
  items: [
    {
      id: 'root-1',
      item_type: 'task',
      title: 'Ship the weekly plan view',
      notes: null,
      due_date: '2026-07-25',
      priority: 'high',
      state: 'completed',
      done: true,
      done_at: '2026-07-24T18:00:00Z',
      created_at: '2026-07-24T09:00:00Z',
      folder: null,
      in_inbox: false,
      code: null,
      children: [],
    },
    {
      id: 'root-2',
      item_type: 'code',
      title: 'Per-voice mute in the mixer',
      notes: null,
      due_date: null,
      priority: null,
      state: 'ready_for_review',
      done: false,
      done_at: null,
      created_at: '2026-07-24T09:00:00Z',
      folder: null,
      in_inbox: true,
      code: { ref: 'RPL-142', lane: 'human' },
      children: [],
    },
    {
      id: 'root-3',
      item_type: 'unclassified',
      title: "Decide what Q4's third rock actually is",
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
    },
  ],
};

/**
 * `WeeklyPlanItems` fetches its own cohort on mount, so every story that renders a selected
 * plan (all but `Empty`, where there is no plan to read a cohort for) stubs `fetch` for it —
 * same reasoning as `PrRatio` / `LocVelocity`.
 */
const withItemsFetch = stubEndpoint(200, ITEMS);

const meta = {
  title: 'Tasks/WeeklyPlanView',
  component: WeeklyPlanView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WeeklyPlanView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Several weeks archived: the picker lists them newest-first, labelled by upload date. */
export const Populated: Story = {
  parameters: {
    store: { weeklyPlans: { index: [summary(LATEST), summary(OLDER)], latest: LATEST } },
  },
  decorators: [withItemsFetch],
};

/** A single upload — nothing to pick between, so the picker is hidden. */
export const SinglePlan: Story = {
  parameters: { store: { weeklyPlans: { index: [summary(LATEST)], latest: LATEST } } },
  decorators: [withItemsFetch],
};

/** Nothing uploaded yet: the empty state carries the upload instruction, not an error. */
export const Empty: Story = {
  parameters: { store: { weeklyPlans: { index: [] } } },
};
