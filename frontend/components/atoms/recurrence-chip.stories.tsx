import type { Meta, StoryObj } from '@storybook/nextjs';

import type { RecurrenceRule } from '@/lib/recurrence';

import { RecurrenceChip } from './recurrence-chip';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/RecurrenceChip',
  component: RecurrenceChip,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof RecurrenceChip>;

export default meta;

type Story = StoryObj<typeof meta>;

const weekly: RecurrenceRule = {
  freq: 'weekly',
  interval: 2,
  byweekday: [1, 3],
  end: { type: 'never' },
};
const daily: RecurrenceRule = { freq: 'daily', interval: 1, end: { type: 'never' } };
const monthly: RecurrenceRule = {
  freq: 'monthly',
  interval: 1,
  monthly: { kind: 'positional', setpos: -1, weekday: 5 },
  end: { type: 'never' },
};
const ending: RecurrenceRule = {
  freq: 'daily',
  interval: 1,
  end: { type: 'on_date', until: '2026-08-01' },
};

export const Daily: Story = { args: { rule: daily } };
export const WeeklyMultiDay: Story = { args: { rule: weekly } };
export const MonthlyPositional: Story = { args: { rule: monthly } };
export const WithEndDate: Story = { args: { rule: ending } };
