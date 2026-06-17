import type { Meta, StoryObj } from '@storybook/nextjs';

import { NewStoryDialog } from './new-story-dialog';

const meta = {
  title: 'Code/NewStoryDialog',
  component: NewStoryDialog,
  parameters: {
    layout: 'centered',
  },
  args: {
    open: true,
    onOpenChange: () => {},
    epicName: 'Communication Firewall',
    onCreateStory: async () => {},
  },
} satisfies Meta<typeof NewStoryDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The dialog open and ready to receive a story title. */
export const Open: Story = {};

/** The dialog with a longer epic name to verify title wrapping. */
export const LongEpicName: Story = {
  args: {
    epicName: 'Backend Infrastructure Modernization',
  },
};
