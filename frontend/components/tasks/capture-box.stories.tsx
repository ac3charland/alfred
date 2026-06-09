import type { Meta, StoryObj } from '@storybook/nextjs';

import { CaptureBox } from './capture-box';

const meta = {
  title: 'Tasks/CaptureBox',
  component: CaptureBox,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof CaptureBox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithFolder: Story = {
  args: {
    folderId: 'folder-123',
  },
};

export const Compact: Story = {
  args: {
    compact: true,
  },
};

export const CompactWithParent: Story = {
  args: {
    compact: true,
    parentId: 'parent-task-1',
  },
};
