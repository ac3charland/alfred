import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { TypeBadge } from './type-badge';

const meta = {
  title: 'Tasks/TypeBadge',
  component: TypeBadge,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof TypeBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Task: Story = {
  args: { itemType: 'task' },
};

export const Code: Story = {
  args: { itemType: 'code' },
};

// The third label (ALF-105) — same muted pill as Task and Code, since it is one value of a
// three-way field, not a warning. The row decides where it shows (select mode only).
export const Unclassified: Story = {
  args: { itemType: 'unclassified' },
};
