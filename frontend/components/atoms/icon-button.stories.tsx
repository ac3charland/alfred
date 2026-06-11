import type { Meta, StoryObj } from '@storybook/nextjs';
import { Check, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { IconButton } from './icon-button';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
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

// ── Hover states ──────────────────────────────────────────────────────────────
// Each tone fades to a different colour on hover (neutral → foreground, accent/affirm
// → teal, danger → destructive). The test-runner moves a real pointer onto the button
// so the CSS `:hover` pseudo-class actually engages in the captured image.

export const NeutralHover: Story = {
  args: { tone: 'neutral' },
  parameters: { visualTest: { hover: true } },
};

export const AccentHover: Story = {
  args: { tone: 'accent' },
  parameters: { visualTest: { hover: true } },
};

export const AffirmHover: Story = {
  args: { tone: 'affirm', 'aria-label': 'Save', children: <Check size={14} /> },
  parameters: { visualTest: { hover: true } },
};

export const DangerHover: Story = {
  args: { tone: 'danger', 'aria-label': 'Delete', children: <Trash2 size={14} /> },
  parameters: { visualTest: { hover: true } },
};

// Keyboard focus draws the tone's `focus-visible` ring (neutral → blue).
export const Focused: Story = {
  args: { tone: 'neutral' },
  parameters: { visualTest: { focus: true } },
};
