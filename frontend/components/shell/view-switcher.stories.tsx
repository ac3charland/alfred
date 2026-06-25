import type { Meta, StoryObj } from '@storybook/nextjs';

import { ViewSwitcher } from '@/components/shell/view-switcher';

const meta = {
  title: 'Shell/ViewSwitcher',
  component: ViewSwitcher,
  parameters: {
    layout: 'padded',
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/' },
    },
    visualTest: { target: '[role="group"]' },
  },
} satisfies Meta<typeof ViewSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Tasks active — the default landing route. */
export const TasksActive: Story = {};

/** Code active — /code route. */
export const CodeActive: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/code' },
    },
  },
};
