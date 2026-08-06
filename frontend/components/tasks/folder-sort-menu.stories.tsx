import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { FolderSortMenu } from './folder-sort-menu';

const meta = {
  title: 'Tasks/FolderSortMenu',
  component: FolderSortMenu,
  tags: ['autodocs'],
  args: { onChange: () => {} },
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof FolderSortMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

// The resting ordering every folder opens on — a plain outline trigger.
export const ByPriority: Story = {
  args: { value: 'priority' },
};

// Off the default: the trigger takes the teal treatment, so a folder ordered by date is
// recognisable without opening the menu.
export const ByDueDate: Story = {
  args: { value: 'due' },
};
