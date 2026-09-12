import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';

import { TypeGlyph } from './type-glyph';

const meta = {
  title: 'Tasks/TypeGlyph',
  component: TypeGlyph,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { className: 'h-4 w-4 text-muted-foreground' },
} satisfies Meta<typeof TypeGlyph>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CodeIcon: Story = {
  args: { itemType: 'code' },
};

export const TaskIcon: Story = {
  args: { itemType: 'task' },
};

// Unclassified renders nothing — the ALF-224 icon only names the two types that need one where
// their usual affordance (checkbox / tick box) doesn't already say it.
export const Unclassified: Story = {
  args: { itemType: 'unclassified' },
};
