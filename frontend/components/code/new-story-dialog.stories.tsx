import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent, within } from 'storybook/test';

import type { CodeStory } from '@/lib/types';

import { NewStoryDialog } from './new-story-dialog';

const meta = {
  title: 'Code/NewStoryDialog',
  component: NewStoryDialog,
  parameters: {
    layout: 'fullscreen',
    // The dialog renders in a Radix portal (outside #storybook-root), so target the dialog
    // content itself for the visual snapshot (per the storybook skill's portal note).
    visualTest: { target: '[role="dialog"]' },
  },
  args: {
    open: true,
    onOpenChange: () => {},
    epicName: 'Communication Firewall',
    epicRef: 'ALF-1',
    onCreateStory: () => Promise.resolve({} as CodeStory),
  },
} satisfies Meta<typeof NewStoryDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The new-story modal open on an epic: a required Title (autofocused) and an optional Notes
 * field, with the Cancel / Create actions. Create is disabled until the title is non-empty.
 */
export const Open: Story = {};

/**
 * The dialog with **Needs refinement** unchecked: the description's trailing state follows the
 * box to *Ready for Dev*, and the hint spells out that the story is created with no spec.
 */
export const NoRefinementNeeded: Story = {
  play: async () => {
    // The dialog renders in a Radix portal (outside the canvas), so query the document body.
    const box = await within(document.body).findByRole('checkbox', { name: /needs refinement/i });
    await userEvent.click(box);
  },
};
