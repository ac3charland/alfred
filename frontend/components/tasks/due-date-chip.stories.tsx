import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { DueDateChip } from './due-date-chip';

const meta = {
  title: 'Tasks/DueDateChip',
  component: DueDateChip,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="inline-flex p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DueDateChip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Today's local calendar date as a YYYY-MM-DD string — lands the chip in the "due today" band. */
function todayLocalYMD(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A date still in the future — the calm blue "upcoming" treatment.
export const Upcoming: Story = {
  args: { dueDate: '2099-12-31' },
};

// Due exactly today — the amber (yellow) "due today" treatment.
export const DueToday: Story = {
  args: { dueDate: todayLocalYMD() },
};

// Past due — the red "overdue" treatment.
export const Overdue: Story = {
  args: { dueDate: '2000-01-01' },
};

// All three urgency bands together, so the red/amber/blue progression reads at a glance.
export const UrgencyBands: Story = {
  // `render` composes its own chips below; this arg only satisfies the required `dueDate` prop.
  args: { dueDate: '2099-12-31' },
  render: () => (
    <div className="flex items-center gap-3">
      <DueDateChip dueDate="2000-01-01" aria-label="Overdue example" />
      <DueDateChip dueDate={todayLocalYMD()} aria-label="Due today example" />
      <DueDateChip dueDate="2099-12-31" aria-label="Upcoming example" />
    </div>
  ),
};
