import type { Meta, StoryObj } from '@storybook/nextjs';

import { TextField } from './text-field';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/TextField',
  component: TextField,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: {
    'aria-label': 'Inline field',
    placeholder: 'Type here…',
  },
} satisfies Meta<typeof TextField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: 'Buy milk' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Read only' },
};

export const DateInput: Story = {
  args: { type: 'date', 'aria-label': 'Due date', className: '[color-scheme:dark]' },
};

// Keyboard focus draws the signature teal `focus-visible` ring — the TextField has no
// hover style, so focus is its one interactive state.
export const Focused: Story = {
  parameters: { visualTest: { focus: true } },
};
