import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { InstanceConfig } from '@/lib/instance';

import { InstanceMenu } from './instance-menu';

const mockSignOut = jest.fn();
jest.mock('@/lib/auth/actions', () => ({
  signOut: () => {
    mockSignOut();
  },
}));

const PERSONAL: InstanceConfig = {
  label: 'Personal',
  accent: 'teal',
  other: { label: 'Work', url: 'https://work.alfred.app' },
};

describe('InstanceMenu', () => {
  beforeEach(() => {
    mockSignOut.mockReset();
  });

  it('renders a labelled trigger showing this instance and its accent', () => {
    render(<InstanceMenu email="ac3charland@gmail.com" instance={PERSONAL} />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveTextContent('Personal');
    expect(trigger).toHaveClass('text-accent-teal');
  });

  it('reveals the instance label and signed-in email when opened', async () => {
    const user = userEvent.setup();
    render(<InstanceMenu email="ac3charland@gmail.com" instance={PERSONAL} />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    expect(screen.getByText('ac3charland@gmail.com')).toBeInTheDocument();
    // The header pill repeats the instance label inside the open menu.
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Personal');
  });

  it('renders the Open-other link pointing at the other origin with rel=noreferrer', async () => {
    const user = userEvent.setup();
    render(<InstanceMenu email="ac3charland@gmail.com" instance={PERSONAL} />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    const link = screen.getByRole('menuitem', { name: 'Open Work' });
    expect(link).toHaveAttribute('href', 'https://work.alfred.app');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('omits the Open-other link when no other instance is configured', async () => {
    const user = userEvent.setup();
    render(<InstanceMenu email="ac3charland@gmail.com" instance={{ ...PERSONAL, other: null }} />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    expect(screen.queryByRole('menuitem', { name: /^Open/ })).not.toBeInTheDocument();
  });

  it('still exposes Sign out, wired to the signOut server action', async () => {
    const user = userEvent.setup();
    render(<InstanceMenu email="ac3charland@gmail.com" instance={PERSONAL} />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    // Radix portals set pointer-events:none on the body, so select via the keyboard.
    await user.keyboard('[ArrowUp][Enter]');

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('tints the trigger with the amber accent for the Work instance', () => {
    render(
      <InstanceMenu
        email="ac3charland@gmail.com"
        instance={{
          label: 'Work',
          accent: 'amber',
          other: { label: 'Personal', url: 'https://personal.alfred.app' },
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveClass('text-accent-amber');
  });

  it('renders without an email (header shows the instance only)', async () => {
    const user = userEvent.setup();
    render(<InstanceMenu email={null} instance={PERSONAL} />);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await screen.findByRole('menu');

    expect(screen.getByRole('menu')).toHaveTextContent('Personal');
  });
});
