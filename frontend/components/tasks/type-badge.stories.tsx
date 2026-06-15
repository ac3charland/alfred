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

// Unclassified renders nothing — the row shows no badge until it's classified. Kept as a
// story so the "no chrome" state is documented (it captures an empty padded frame).
export const Unclassified: Story = {
  args: { itemType: 'unclassified' },
};
