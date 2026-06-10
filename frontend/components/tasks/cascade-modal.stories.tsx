import type { Meta, StoryObj } from '@storybook/nextjs';

import { CascadeModal } from './cascade-modal';

const meta = {
  title: 'Tasks/CascadeModal',
  component: CascadeModal,
  tags: ['autodocs'],
  args: {
    // Inert no-op stubs — these stories don't assert on the callbacks.
    open: true,
    onOpenChange: () => {},
    taskTitle: 'Plan the product launch',
    subtaskCount: 3,
    onConfirm: () => {},
    isPending: false,
  },
} satisfies Meta<typeof CascadeModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SingleSubtask: Story = {
  args: {
    subtaskCount: 1,
  },
};

export const ManySubtasks: Story = {
  args: {
    subtaskCount: 12,
  },
};

export const Pending: Story = {
  args: {
    isPending: true,
  },
};

export const Closed: Story = {
  args: {
    open: false,
  },
};
