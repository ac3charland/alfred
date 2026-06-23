import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { DueCountBadge } from './due-count-badge';

const meta = {
  title: 'Tasks/DueCountBadge',
  component: DueCountBadge,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof DueCountBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { count: 1 },
};

export const Several: Story = {
  args: { count: 5 },
};

// Zero renders nothing — the folder link shows no chip until something is due. Kept as a
// story so the "no chrome" state is documented (it captures an empty padded frame).
export const None: Story = {
  args: { count: 0 },
};
