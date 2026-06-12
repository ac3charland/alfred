import type { Meta, StoryObj } from '@storybook/nextjs';

import { Spinner } from './spinner';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  // The Spinner's `animate-spin` is frozen at capture time (see .storybook/test-runner.ts)
  // so the rotation is deterministic across runs.
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Saving: Story = {
  args: { label: 'Saving' },
};

export const Large: Story = {
  args: { size: 28 },
};

export const Teal: Story = {
  args: { className: 'text-accent-teal' },
};
