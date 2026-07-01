import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { FolderCountBadge } from './folder-count-badge';

const meta = {
  title: 'Tasks/FolderCountBadge',
  component: FolderCountBadge,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof FolderCountBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

// The amber "attention" tally — high-priority or due-today tasks that aren't yet overdue.
export const Attention: Story = {
  args: { tone: 'attention', count: 3 },
};

// The red "overdue" tally — active tasks already past due.
export const Overdue: Story = {
  args: { tone: 'overdue', count: 2 },
};

// Zero renders nothing — the folder link shows no chip until something needs attention. Kept as a
// story so the "no chrome" state is documented (it captures an empty padded frame).
export const None: Story = {
  args: { tone: 'attention', count: 0 },
};
