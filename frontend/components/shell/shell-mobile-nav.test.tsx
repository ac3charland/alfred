import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { SearchProvider } from '@/lib/stores/search-store';
import { renderWithProviders } from '@/lib/test-utils';

import { ShellMobileNav } from './shell-mobile-nav';

// Mock next/navigation — the drawer reads the active route to pick which nav to render.
const mockPathname = jest.fn<string, []>(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter() {
    return { push: jest.fn() };
  },
}));

// FolderNav mutates through the api-client on its actions; stub it so nothing hits the network.
jest.mock('@/lib/api-client');

beforeEach(() => {
  mockPathname.mockReturnValue('/');
  jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

function renderMobileNav() {
  return renderWithProviders(
    <SearchProvider>
      <ShellMobileNav />
    </SearchProvider>,
  );
}

describe('ShellMobileNav', () => {
  it('does not autofocus the search field when the drawer opens', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    // The drawer's search field must not steal focus on open — auto-focusing it pops the
    // mobile keyboard and (via onFocus) opens the results dropdown every time the drawer opens.
    const search = await screen.findByRole('combobox', { name: 'Search tasks and stories' });
    expect(search).not.toHaveFocus();
  });

  it('does not open the search results dropdown when the drawer opens', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await screen.findByRole('combobox', { name: 'Search tasks and stories' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('still opens the drawer with its search field and navigation', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(
      await screen.findByRole('combobox', { name: 'Search tasks and stories' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  });
});
