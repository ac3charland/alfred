import type { Meta, StoryObj } from '@storybook/nextjs';

import { StatusDot } from './status-dot';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/StatusDot',
  component: StatusDot,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { label: 'Personal', title: 'Last synced 2 minutes ago' },
} satisfies Meta<typeof StatusDot>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Live: Story = {
  args: { state: 'live' },
};

export const Stale: Story = {
  args: { state: 'stale', title: 'Last synced 4 hours ago', elapsed: '4h' },
};

export const Erroring: Story = {
  args: { state: 'erroring', title: 'The refresh token was rejected (12m)', elapsed: '12m' },
};
