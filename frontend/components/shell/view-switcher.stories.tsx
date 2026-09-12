import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { ViewSwitcher } from '@/components/shell/view-switcher';

/**
 * Frame the switcher in the desktop sidebar's real geometry — `w-56` with the `px-4` its
 * header block carries (see `app-shell.tsx`) — because the control now sizes itself from its
 * container rather than from its labels. Captured on the canvas it would simply stretch to the
 * canvas width, and the snapshot would stop showing the thing that matters: that three
 * segments fit the sidebar without clipping or spilling over its border (ALF-219).
 */
const withSidebarFrame: Decorator = (Story) => (
  <div
    data-testid="sidebar-frame"
    className="w-56 border-r border-border bg-surface px-4 py-3 text-foreground"
  >
    <Story />
  </div>
);

const meta = {
  title: 'Shell/ViewSwitcher',
  component: ViewSwitcher,
  decorators: [withSidebarFrame],
  parameters: {
    layout: 'padded',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/' },
    },
    visualTest: { target: '[data-testid="sidebar-frame"]' },
  },
} satisfies Meta<typeof ViewSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Tasks active — the default landing route. The module that wears the amber accent. */
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
