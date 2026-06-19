import type { Meta, StoryObj } from '@storybook/nextjs';
import { Check } from 'lucide-react';

import { CheckboxButton } from './checkbox-button';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/CheckboxButton',
  component: CheckboxButton,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { 'aria-label': 'Mark complete' },
} satisfies Meta<typeof CheckboxButton>;

export default meta;

type Story = StoryObj<typeof meta>;

// Empty box — the task-row completion checkbox before it's checked.
export const Unchecked: Story = {
  args: {
    className: 'h-4 w-4 border-border hover:border-accent-teal transition-colors',
  },
};

// Filled teal box with a check — the completed / confirm-title appearance.
export const Checked: Story = {
  args: {
    className: 'h-5 w-5 border-accent-teal bg-accent-teal',
    children: <Check size={12} className="text-background" strokeWidth={3} />,
  },
};

export const Focused: Story = {
  args: { className: 'h-5 w-5 border-accent-teal bg-accent-teal' },
  parameters: { visualTest: { focus: true } },
};
