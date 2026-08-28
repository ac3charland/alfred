import type { Meta, StoryObj } from '@storybook/nextjs';

import { UnitField } from './unit-field';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

const meta = {
  title: 'Atoms/UnitField',
  component: UnitField,
  tags: ['autodocs'],
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: {
    'aria-label': 'Meditate',
    type: 'number',
    className: 'w-[92px] px-1.5 py-0.5 font-mono text-xs',
  },
} satisfies Meta<typeof UnitField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A duration: the number is bare minutes, so the field carries the unit. */
export const WithUnit: Story = {
  args: { unit: 'min', defaultValue: '20' },
};

// The unit is a caption, not a border — it must not read as part of the input it sits beside.
export const Empty: Story = {
  args: { unit: 'min' },
};

/** No unit: a count says what it counts in the label beside it, so the field stays bare. */
export const Unitless: Story = {
  args: { defaultValue: '3' },
};
