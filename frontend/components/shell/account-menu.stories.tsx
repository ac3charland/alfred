import type { Meta, StoryObj } from '@storybook/nextjs';
import { screen, userEvent, within } from 'storybook/test';

import { AccountMenu } from './account-menu';

const meta = {
  title: 'Shell/AccountMenu',
  component: AccountMenu,
  parameters: {
    layout: 'padded',
    // The menu portals to <body>, so the snapshot targets the open menu itself, not the story root.
    visualTest: { target: '[role="menu"]' },
  },
  args: {
    email: 'ac3charland@gmail.com',
  },
  // Open the menu so the snapshot captures the email header and Sign out.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');
  },
} satisfies Meta<typeof AccountMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Signed in — the email header above Sign out. */
export const SignedIn: Story = {};

/** No email available — the menu is just Sign out. */
export const NoEmail: Story = {
  args: { email: null },
};

/** Closed — the header's icon trigger alone, as it sits beside the mobile hamburger. */
export const Closed: Story = {
  parameters: { visualTest: { target: 'button[aria-label="Account menu"]' } },
  play: () => Promise.resolve(),
};
