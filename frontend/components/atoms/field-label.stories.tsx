import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { FieldLabel } from './field-label';
import { TextField } from './text-field';

const meta = {
  title: 'Atoms/FieldLabel',
  component: FieldLabel,
  tags: ['autodocs'],
  args: { children: 'Due date' },
} satisfies Meta<typeof FieldLabel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  // Rendered with its control so the htmlFor association is visible.
  render: (args) => (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor="demo-field" {...args} />
      <TextField id="demo-field" placeholder="2026-06-10" />
    </div>
  ),
};
