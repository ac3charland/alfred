import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { ViewSwitcher } from '@/components/shell/view-switcher';
import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';

/**
 * Frame the switcher in the desktop sidebar's real geometry — `w-70` with the `px-4` its
 * header block carries (see `app-shell.tsx`) — because the control now sizes itself from its
 * container rather than from its labels. Captured on the canvas it would simply stretch to the
 * canvas width, and the snapshot would stop showing the thing that matters: that the segments
 * fit the sidebar without clipping or spilling over its border (ALF-219). The sidebar widened
 * from `w-56` to `w-64` for the fourth (Reader) segment (ALF-233), then from `w-64` to `w-68`
 * to `w-70` for the fifth (Wiki) segment (ALF-261) — `w-68` (272px) still left every label 1px
 * short of its content width — this frame follows it.
 */
const withSidebarFrame: Decorator = (Story) => (
  <div
    data-testid="sidebar-frame"
    className="w-70 border-r border-border bg-surface px-4 py-3 text-foreground"
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

/** Reader active — /reader route, the module that wears the green accent (ALF-233). */
export const ReaderActive: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/reader' },
    },
  },
};

/** Wiki active — /wiki route, the fifth module, which wears the violet accent (ALF-261). */
export const WikiActive: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/wiki' },
    },
  },
};

const QUEUE_ACCOUNT = makeCommAccount('personal');

/**
 * Comms carries a queue count (ALF-222): the corner badge over its top-right, and Comms itself
 * moved to the control's far right so the badge lands at the row's own end rather than a corner
 * in the middle.
 *
 * `visualTest: null` opts this one story out of the meta-level snapshot (it would otherwise
 * inherit `withSidebarFrame`'s target and need a brand-new baseline) — the queue count is
 * already pinned by `view-switcher.test.tsx` and `comms-shell.spec.ts`; this story is for local
 * exploration and demo screenshots, not the visual-regression gate.
 */
export const CommsActiveWithQueueBadge: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/comms' },
    },
    visualTest: null,
    store: {
      comms: {
        accounts: [QUEUE_ACCOUNT],
        messages: [
          makeCommMessage(QUEUE_ACCOUNT.id, { tier: 'asap', judged_by: 'model' }),
          makeCommMessage(QUEUE_ACCOUNT.id, { tier: 'today', judged_by: 'model' }),
          // On the shelf, so uncounted.
          makeCommMessage(QUEUE_ACCOUNT.id, { tier: 'fyi', judged_by: 'model' }),
        ],
      },
    },
  },
};
