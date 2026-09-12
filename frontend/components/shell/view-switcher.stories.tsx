import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { VISUAL_TARGET } from '@/components/atoms/visual-test';
import { ViewSwitcher } from '@/components/shell/view-switcher';

/**
 * The switcher is a full-width control (ALF-219), so letting it fill the Storybook canvas would
 * snapshot a shape the app never renders — and would hide the overflow this story exists to
 * guard. The frame is the real constraint: the desktop sidebar's 224px, less its 1px right
 * border and 16px of padding a side.
 */
const withSidebarWidth: Decorator = (Story) => (
  <div data-testid="visual-frame" className="w-[191px] bg-surface">
    <Story />
  </div>
);

const meta = {
  title: 'Shell/ViewSwitcher',
  component: ViewSwitcher,
  decorators: [withSidebarWidth],
  parameters: {
    layout: 'padded',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/' },
    },
    visualTest: { target: VISUAL_TARGET },
  },
} satisfies Meta<typeof ViewSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Tasks active — the default landing route, and the module that wears the amber accent. */
export const TasksActive: Story = {};

/** Code active — /code route, the module that keeps the app's teal. */
export const CodeActive: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/code' },
    },
  },
};

/** Comms active — /comms route, the module that wears the blue accent. */
export const CommsActive: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/comms' },
    },
  },
};
