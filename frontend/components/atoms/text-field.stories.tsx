import type { Meta, StoryObj } from '@storybook/nextjs';

import { TextField } from './text-field';

const meta = {
  title: 'Atoms/TextField',
  component: TextField,
  tags: ['autodocs'],
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
