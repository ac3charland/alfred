import type { Meta, StoryObj } from '@storybook/nextjs';

import { CascadeModal } from './cascade-modal';

// Storybook action stubs — the actions addon logs invocations in the panel, so
// these handlers only need to exist. The `_`-prefixed param mirrors the
// `onOpenChange` signature while marking it deliberately unused.
function handleOpenChange(_open: boolean) {
  return;
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
