import type { Meta, StoryObj } from '@storybook/nextjs';
import { Check, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { IconButton } from './icon-button';

const meta = {
  title: 'Atoms/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Add',
    children: <Plus size={14} />,
  },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  args: { tone: 'neutral' },
};

export const Accent: Story = {
  args: { tone: 'accent' },
};

export const Affirm: Story = {
  args: { tone: 'affirm', 'aria-label': 'Save', children: <Check size={14} /> },
};

export const Danger: Story = {
  args: { tone: 'danger', 'aria-label': 'Delete', children: <Trash2 size={14} /> },
};

export const Disabled: Story = {
  args: { disabled: true },
};
