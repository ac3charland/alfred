import type { Meta, StoryObj } from '@storybook/nextjs';

import { Textarea } from './textarea';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: {
    'aria-label': 'Notes',
    placeholder: 'Add notes…',
    rows: 3,
    className: 'w-64',
  },
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: 'Refine the atoms audit before the demo.' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Read only' },
};

// The bordered base has no hover style, so keyboard focus (the teal `focus-visible` ring) is
// its one interactive state.
export const Focused: Story = {
  parameters: { visualTest: { focus: true } },
};

// `unstyled` drops the border / bg / ring so the surrounding container can own the chrome
// (the hero capture box). Shown on a framed wrapper to make the transparent textarea visible.
export const Unstyled: Story = {
  args: {
    unstyled: true,
    'aria-label': 'Capture',
    placeholder: 'What’s on your mind?',
    className: 'w-64 bg-transparent px-4 py-3',
  },
};
