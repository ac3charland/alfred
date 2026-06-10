import type { Meta, StoryObj } from '@storybook/nextjs';

import { Spinner } from './spinner';

const meta = {
  title: 'Atoms/Spinner',
  component: Spinner,
  tags: ['autodocs'],
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
