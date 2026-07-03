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

/**
 * The modal at the desktop default viewport — its `max-w-md` (448px) content centered on the
 * dimmed overlay. The dialog renders in a portal, so the snapshot targets the dialog itself.
 */
export const DesktopModal: Story = {
  parameters: {
    visualTest: { target: '[role="dialog"]' },
  },
};

/**
 * The same modal at a phone viewport (390×844): `w-full max-w-md` resolves to the full 390px
 * width, so the dialog spans the screen edge-to-edge — the mobile audit for a centered modal.
 */
export const MobileModal: Story = {
  parameters: {
    visualTest: { target: '[role="dialog"]', viewport: { width: 390, height: 844 } },
  },
};
