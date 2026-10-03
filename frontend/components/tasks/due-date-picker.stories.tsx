import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { DueDatePicker } from './due-date-picker';

const meta = {
  title: 'Tasks/DueDatePicker',
  component: DueDatePicker,
  tags: ['autodocs'],
  args: { onSelect: () => {}, onClear: () => {}, onSetTime: () => {} },
  decorators: [
    (Story) => (
      <div className="inline-flex rounded-md border border-border bg-popover p-1">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DueDatePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

// Before a time is set: the Time row is the "Add time" link under the grid.
export const NoTime: Story = {
  args: { dueDate: '2026-10-04', dueTime: null },
};

// With a time: the native time field plus the × that clears just the time.
export const TimeSet: Story = {
  args: { dueDate: '2026-10-04', dueTime: '15:00' },
};
