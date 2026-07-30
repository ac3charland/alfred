import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';
import { LockedCadenceSlot, LockedSlotExplanation } from '@/components/habits/habit-sentence-form';

/**
 * The committed baselines for the one piece of visual language this slice invents: a cadence slot
 * frozen because the habit has history.
 *
 * It is a VISUAL requirement — a muted plate with a padlock where the editable slots carry a teal
 * dashed underline — so a PNG is what keeps it from drifting into looking either editable (which
 * would make it a control that ignores clicks) or disabled-and-dead (which would make it look
 * broken). The explanation gets its own baseline because it is the other half of the treatment.
 *
 * Every count is a literal, so no baseline moves with the calendar.
 */
const meta = {
  title: 'Habits/LockedSlot',
  component: LockedCadenceSlot,
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof LockedCadenceSlot>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The frozen allowance slot as it sits in the sentence, closed. */
export const Slot: Story = {
  args: {
    slot: 'slack',
    label: 'Allowance:',
    value: '1 miss a week',
    logged: { count: 63, isExact: true },
  },
};

/** What the slot says when it is clicked — the click answers rather than doing nothing. */
export const Explanation: StoryObj<typeof LockedSlotExplanation> = {
  render: () => <LockedSlotExplanation slot="slack" logged={{ count: 63, isExact: true }} />,
};

/**
 * A habit older than the seeded entry window: the client can only vouch for a floor, and the
 * sentence hedges rather than claiming a total it cannot know.
 */
export const ExplanationWithPartialCount: StoryObj<typeof LockedSlotExplanation> = {
  render: () => <LockedSlotExplanation slot="days" logged={{ count: 118, isExact: false }} />,
};
