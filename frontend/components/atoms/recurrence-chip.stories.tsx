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
  // This year's Aug 1, so the snapshot reads "until Aug 1" whatever year it runs in (a date in
  // another year would carry its year — ALF-303).
  end: { type: 'on_date', until: `${String(new Date().getFullYear())}-08-01` },
};

export const Daily: Story = { args: { rule: daily } };
export const WeeklyMultiDay: Story = { args: { rule: weekly } };
export const MonthlyPositional: Story = { args: { rule: monthly } };
export const WithEndDate: Story = { args: { rule: ending } };

// ALF-303: an end date outside the current year carries its year — "until Aug 1, 2099".
export const WithEndDateOtherYear: Story = {
  args: { rule: { ...ending, end: { type: 'on_date', until: '2099-08-01' } } },
};
