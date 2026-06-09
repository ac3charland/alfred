import type { Meta, StoryObj } from '@storybook/nextjs';

import { CascadeModal } from './cascade-modal';

// Storybook action stubs — Storybook replaces these at render time via the
// `actions` addon, so a no-op that logs is good enough for static stories.
function handleOpenChange(open: boolean) {
  // Storybook action stub — logs open state for the actions panel
  // eslint will flag this if empty, so we reference the arg:
  return open;
}

function handleConfirm() {
  return;
}

const meta = {
  title: 'Tasks/CascadeModal',
  component: CascadeModal,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: handleOpenChange,
    taskTitle: 'Plan the product launch',
    subtaskCount: 3,
    onConfirm: handleConfirm,
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
