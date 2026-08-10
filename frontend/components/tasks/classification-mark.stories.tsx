import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { ClassificationMark } from './classification-mark';

const meta = {
  title: 'Tasks/ClassificationMark',
  component: ClassificationMark,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof ClassificationMark>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The classifier wrote this row's labels — the loudest of the three weights. */
export const Model: Story = {
  args: { origin: 'model' },
};

/** A human edit claimed the row before the sweeper reached it. */
export const Claimed: Story = {
  args: { origin: 'claimed' },
};

/** Nothing has judged it yet — the faintest, and the state an Inbox row is in most often. */
export const Unjudged: Story = {
  args: { origin: 'unjudged' },
};
