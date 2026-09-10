import type { Meta, StoryObj } from '@storybook/nextjs';

import { makeCommRubric } from '@/lib/comms/fixtures';

import { CommsRubricView } from './comms-rubric-view';

/**
 * The rubric editor and its history.
 *
 * Every `created_at` is a permanently-past literal rather than anything near today: the saved-at
 * line is relative for a week and an absolute date after it, so a near-term fixture would drift
 * through both forms and move the baseline with the calendar.
 */
const V1 = makeCommRubric(
  ['Anything from my wife is ASAP.', 'Recruiters are never urgent.'].join('\n'),
  { version: 1, created_at: '2020-03-14T09:00:00.000Z' },
);

const V2 = makeCommRubric(
  [
    'Anything from my wife is ASAP.',
    'Mail with an invoice or a deadline in it goes to Today.',
    'Recruiters are never urgent, however the message reads.',
    'A thread I started myself is Whenever unless someone asks me something directly.',
  ].join('\n'),
  { version: 2, created_at: '2020-06-02T09:00:00.000Z' },
);

const meta = {
  title: 'Comms/RubricView',
  component: CommsRubricView,
} satisfies Meta<typeof CommsRubricView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A written policy, its version stated, with an earlier version collapsed underneath. */
export const WithRubric: Story = {
  parameters: {
    store: { commsSettings: { rubrics: [V2, V1] } },
    visualTest: {},
  },
};

/** Before anything has been written: the placeholder is the whole of the instruction. */
export const Blank: Story = {
  parameters: { store: { commsSettings: { rubrics: [] } } },
};
