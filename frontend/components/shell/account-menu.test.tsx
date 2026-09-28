import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { AccountMenu } from './account-menu';

const mockSignOut = jest.fn();
jest.mock('@/lib/auth/actions', () => ({
  signOut: () => {
    mockSignOut();
  },
}));

describe('AccountMenu', () => {
  beforeEach(() => {
    mockSignOut.mockReset();
  });

  it('renders an icon-only trigger labelled "Account menu" with no instance label', () => {
    render(<AccountMenu email="ac3charland@gmail.com" />);

    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('');
  });

  it('reveals the signed-in email when opened', async () => {
    const user = userEvent.setup();
    render(<AccountMenu email="ac3charland@gmail.com" />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(await screen.findByRole('menu')).toHaveTextContent('ac3charland@gmail.com');
  });

  it('offers no link out to another instance', async () => {
    const user = userEvent.setup();
    render(<AccountMenu email="ac3charland@gmail.com" />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('exposes Sign out, wired to the signOut server action', async () => {
    const user = userEvent.setup();
    render(<AccountMenu email="ac3charland@gmail.com" />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    // Radix portals set pointer-events:none on the body, so select via the keyboard.
    await user.keyboard('[ArrowDown][Enter]');

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders just Sign out when the email is unavailable', async () => {
    const user = userEvent.setup();
    render(<AccountMenu email={null} />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(await screen.findByRole('menu')).toHaveTextContent(/^Sign out$/);
  });
});
