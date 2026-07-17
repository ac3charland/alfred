import type { Meta, StoryObj } from '@storybook/nextjs';
import { screen, userEvent, within } from 'storybook/test';

import type { InstanceConfig } from '@/lib/instance';

import { InstanceMenu } from './instance-menu';

const PERSONAL: InstanceConfig = {
  label: 'Personal',
  accent: 'teal',
  other: { label: 'Work', url: 'https://work.alfred.app' },
};

const WORK: InstanceConfig = {
  label: 'Work',
  accent: 'amber',
  other: { label: 'Personal', url: 'https://personal.alfred.app' },
};

const meta = {
  title: 'Shell/InstanceMenu',
  component: InstanceMenu,
  parameters: {
    layout: 'padded',
    // The menu portals to <body>, so the snapshot targets the open menu itself, not the story root.
    visualTest: { target: '[role="menu"]' },
  },
  args: {
    email: 'ac3charland@gmail.com',
  },
  // Open the menu so the snapshot captures the header pill, Open-other link, and Sign out.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');
  },
} satisfies Meta<typeof InstanceMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Personal instance — teal accent, linking out to Work. */
export const Personal: Story = {
  args: { instance: PERSONAL },
};

/** Work instance — amber accent, linking out to Personal. */
export const Work: Story = {
  args: { instance: WORK },
};

/** Single deployment / local dev — no other instance configured, so the switch link is hidden. */
export const SoloInstance: Story = {
  args: { instance: { ...PERSONAL, other: null } },
};
