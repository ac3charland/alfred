import type { Meta, StoryObj } from '@storybook/nextjs';

import type { WeeklyPlan } from '@/lib/types';

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
};

/** A single upload — nothing to pick between, so the picker is hidden. */
export const SinglePlan: Story = {
  parameters: { store: { weeklyPlans: { index: [summary(LATEST)], latest: LATEST } } },
};

/** Nothing uploaded yet: the empty state carries the upload instruction, not an error. */
export const Empty: Story = {
  parameters: { store: { weeklyPlans: { index: [] } } },
};
