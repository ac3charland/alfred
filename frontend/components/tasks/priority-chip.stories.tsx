import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { PriorityChip } from './priority-chip';

const meta = {
  title: 'Tasks/PriorityChip',
  component: PriorityChip,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof PriorityChip>;

export default meta;

type Story = StoryObj<typeof meta>;

// The compact row badge, one per level — red / amber / muted (the badge-variant tones).
export const High: Story = { args: { priority: 'high' } };
export const Medium: Story = { args: { priority: 'medium' } };
export const Low: Story = { args: { priority: 'low' } };

// The compact symbol-only form used on a dense task row — icon alone, sized to the text line-box
// so the pill stands the same height as its Type / Due / count neighbours (ALF-94).
export const SymbolOnly: Story = { args: { priority: 'high', symbolOnly: true } };

// The larger `comfortable` chip used in the detail panel / By-Priority view — icon + label, the
// faint-fill tones (low reads blue here), plus the neutral "No priority" prompt when unset.
export const Comfortable: Story = { args: { priority: 'medium', size: 'comfortable' } };
export const ComfortableEmpty: Story = {
  args: { priority: null, size: 'comfortable', emptyLabel: 'No priority' },
};
