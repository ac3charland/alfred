import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { WeekPlanBadge } from './week-plan-badge';

const meta = {
  title: 'Tasks/WeekPlanBadge',
  component: WeekPlanBadge,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof WeekPlanBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The one state it has: a row a weekly review planned. The chip carries no variants. */
export const Default: Story = {};
