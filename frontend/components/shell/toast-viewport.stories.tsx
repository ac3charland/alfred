import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { ToastItem } from './toast-viewport';

// A single toast card is the visual unit the snapshot locks. Rendering ToastItem directly
// (rather than the fixed-position viewport) keeps the capture a tight, deterministic crop and
// sidesteps the store's auto-dismiss timers. The chime lives in the store action, never here,
// so no audio plays from a story.
const meta = {
  title: 'Shell/ToastItem',
  component: ToastItem,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { onDismiss: () => {} },
} satisfies Meta<typeof ToastItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    toast: { id: 'd', message: 'Created ALF-42', variant: 'default', leaving: false },
  },
};

export const Emphasis: Story = {
  args: {
    toast: {
      id: 'e',
      message: 'ALF-42 moved to Ready for Dev',
      variant: 'emphasis',
      leaving: false,
    },
  },
};
