import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { SearchProvider } from '@/lib/stores/search-store';
import { renderWithProviders } from '@/lib/test-utils';

import { ShellMobileNav } from './shell-mobile-nav';

// Mock next/navigation — the drawer reads the active route to pick which nav to render.
// The links inside the drawer navigate with `history.pushState`, which Next patches to
// re-render `usePathname` consumers; this store reproduces that so the drawer re-derives
// its module mid-interaction instead of being frozen at the route it opened on.
const mockPathnameStore = {
  pathname: '/',
  listeners: new Set<() => void>(),
  get: () => mockPathnameStore.pathname,
  set: (next: string) => {
    mockPathnameStore.pathname = next;
    for (const listener of mockPathnameStore.listeners) listener();
  },
  subscribe: (listener: () => void) => {
    mockPathnameStore.listeners.add(listener);
    return () => {
      mockPathnameStore.listeners.delete(listener);
    };
  },
};
const mockUseSyncExternalStore = React.useSyncExternalStore;
jest.mock('next/navigation', () => ({
  usePathname: () =>
    mockUseSyncExternalStore(
      mockPathnameStore.subscribe,
      mockPathnameStore.get,
      mockPathnameStore.get,
    ),
  useRouter() {
    return { push: jest.fn() };
  },
}));

// FolderNav mutates through the api-client on its actions; stub it so nothing hits the network.
jest.mock('@/lib/api-client');

beforeEach(() => {
  mockPathnameStore.pathname = '/';
  jest.spyOn(globalThis.history, 'pushState').mockImplementation((_state, _unused, url) => {
    mockPathnameStore.set(String(url));
  });
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

  it('stays open when the switcher moves to the other module, swapping in its nav', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(await screen.findByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Code' }));

    // Switching modules is a move *within* the menu, so the drawer stays open and simply
    // re-derives which module's nav it shows — the user keeps drilling in from there.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('stays open on a switcher tap that lands back on the module already showing', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(screen.getByRole('link', { name: 'Tasks' }));

    // No segment of the switcher closes the drawer: only a destination inside a module's nav
    // (or a search result) is an "arrived", so the rule stays simple to predict.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('still closes when a destination inside the module nav is picked', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(await screen.findByRole('link', { name: /completed/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
