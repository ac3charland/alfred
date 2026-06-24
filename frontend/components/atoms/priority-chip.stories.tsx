import type { Meta, StoryObj } from '@storybook/nextjs';

import { PriorityChip } from './priority-chip';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/PriorityChip',
  component: PriorityChip,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof PriorityChip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const High: Story = { args: { priority: 'high' } };
export const Medium: Story = { args: { priority: 'medium' } };
export const Low: Story = { args: { priority: 'low' } };
