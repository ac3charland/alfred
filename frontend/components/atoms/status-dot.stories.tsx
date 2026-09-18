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

/**
 * A source whose states have names of its own — the dot's three tones only separate fine from
 * not fine, so the accessible name carries the word the caller would say out loud.
 */
export const NamedState: Story = {
  args: {
    state: 'stale',
    label: 'summariser',
    stateLabel: 'never ran',
    title: 'The summariser has never run — the tick has never fired',
  },
};
