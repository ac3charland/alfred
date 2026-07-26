import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { HAPPY_PATH_STATES } from '@/lib/stores/code-store';

import { BoardToolbar, type BoardToolbarProperties } from './board-toolbar';

function renderToolbar(overrides: Partial<BoardToolbarProperties> = {}) {
  const properties: BoardToolbarProperties = {
    onCreateEpic: jest.fn(),
    hasVisibleEpics: true,
    allCollapsed: false,
    onToggleCollapseAll: jest.fn(),
    statusOptions: HAPPY_PATH_STATES,
    selectedStatuses: HAPPY_PATH_STATES,
    onToggleStatus: jest.fn(),
    isFiltering: false,
    showAbandoned: false,
    onToggleAbandoned: jest.fn(),
    hasArchivedEpics: false,
    showArchived: false,
    onToggleArchived: jest.fn(),
    ...overrides,
  };
  render(<BoardToolbar {...properties} />);
  return properties;
}

/** Open the mobile ⋯ menu and return it. */
async function openMobileMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Board filters' }));
  return screen.findByRole('menu');
}

describe('BoardToolbar', () => {
  describe('the always-visible controls', () => {
    it('keeps "Create epic" visible at every viewport', () => {
      renderToolbar();

      const button = screen.getByRole('button', { name: /create epic/i });
      expect(button).toBeInTheDocument();
      expect(button).not.toHaveClass('md:hidden');
      expect(button).not.toHaveClass('hidden');
    });

    it('calls onCreateEpic when "Create epic" is clicked', async () => {
      const user = userEvent.setup();
      const { onCreateEpic } = renderToolbar();

      await user.click(screen.getByRole('button', { name: /create epic/i }));

      expect(onCreateEpic).toHaveBeenCalledTimes(1);
    });
  });

  describe('the collapse-all control', () => {
    it('condenses to a glyph below md while keeping its label as the accessible name', () => {
      renderToolbar();

      // One accessible name at every viewport: the label is only visually hidden below `md`.
      const button = screen.getByRole('button', { name: 'Collapse all' });
      expect(within(button).getByText('Collapse all')).toHaveClass('sr-only', 'md:not-sr-only');
      // The glyph stands in for the text on a phone, and steps aside from `md` up.
      expect(button.querySelector('svg')).toHaveClass('md:hidden');
      // Below `md` it takes the height of the `Button size="sm"` controls flanking it; from
      // `md` up it relaxes back to the other pill toggles' height.
      expect(button).toHaveClass('h-8', 'md:h-auto');
    });

    it('flips to "Open all" once every visible epic is collapsed', () => {
      renderToolbar({ allCollapsed: true });

      const button = screen.getByRole('button', { name: 'Open all' });
      expect(within(button).getByText('Open all')).toHaveClass('sr-only', 'md:not-sr-only');
      expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument();
    });

    it('is absent when the board shows no epic', () => {
      renderToolbar({ hasVisibleEpics: false });

      expect(
        screen.queryByRole('button', { name: /collapse all|open all/i }),
      ).not.toBeInTheDocument();
    });

    it('calls onToggleCollapseAll when clicked', async () => {
      const user = userEvent.setup();
      const { onToggleCollapseAll } = renderToolbar();

      await user.click(screen.getByRole('button', { name: 'Collapse all' }));

      expect(onToggleCollapseAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('the desktop filter group (md and up)', () => {
    it('renders the status filter, Show abandoned and Show archived inline, hidden below md', () => {
      renderToolbar({ hasArchivedEpics: true });

      const group = screen.getByRole('button', { name: 'Filter by status' }).closest('div');
      expect(group).toHaveClass('hidden', 'md:flex');
      expect(
        within(group as HTMLElement).getByRole('button', { name: /show abandoned/i }),
      ).toBeInTheDocument();
      expect(
        within(group as HTMLElement).getByRole('button', { name: /show archived/i }),
      ).toBeInTheDocument();
    });

    it('omits Show archived when the project has no archived epic', () => {
      renderToolbar({ hasArchivedEpics: false });

      expect(screen.queryByRole('button', { name: /show archived/i })).not.toBeInTheDocument();
    });
  });

  describe('the mobile ⋯ menu (below md)', () => {
    it('renders a three-dot trigger that steps aside from md up', () => {
      renderToolbar();

      expect(screen.getByRole('button', { name: 'Board filters' })).toHaveClass('md:hidden');
    });

    it('offers the same three view filters the desktop group does', async () => {
      const user = userEvent.setup();
      renderToolbar({ hasArchivedEpics: true });

      const menu = await openMobileMenu(user);

      expect(within(menu).getByRole('menuitem', { name: /filter by status/i })).toBeInTheDocument();
      expect(
        within(menu).getByRole('menuitemcheckbox', { name: /show abandoned/i }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole('menuitemcheckbox', { name: /show archived/i }),
      ).toBeInTheDocument();
    });

    it('omits Show archived from the menu when the project has no archived epic', async () => {
      const user = userEvent.setup();
      renderToolbar({ hasArchivedEpics: false });

      const menu = await openMobileMenu(user);

      expect(
        within(menu).queryByRole('menuitemcheckbox', { name: /show archived/i }),
      ).not.toBeInTheDocument();
    });

    it('reflects the current toggle state on its checkbox items', async () => {
      const user = userEvent.setup();
      renderToolbar({ hasArchivedEpics: true, showAbandoned: true, showArchived: false });

      const menu = await openMobileMenu(user);

      expect(within(menu).getByRole('menuitemcheckbox', { name: /show abandoned/i })).toBeChecked();
      expect(
        within(menu).getByRole('menuitemcheckbox', { name: /show archived/i }),
      ).not.toBeChecked();
    });

    it('toggles Show abandoned through the menu', async () => {
      const user = userEvent.setup();
      const { onToggleAbandoned } = renderToolbar();

      const menu = await openMobileMenu(user);
      await user.click(within(menu).getByRole('menuitemcheckbox', { name: /show abandoned/i }));

      expect(onToggleAbandoned).toHaveBeenCalledTimes(1);
    });

    it('toggles Show archived through the menu', async () => {
      const user = userEvent.setup();
      const { onToggleArchived } = renderToolbar({ hasArchivedEpics: true });

      const menu = await openMobileMenu(user);
      await user.click(within(menu).getByRole('menuitemcheckbox', { name: /show archived/i }));

      expect(onToggleArchived).toHaveBeenCalledTimes(1);
    });

    it('toggles a status through the "Filter by status" submenu', async () => {
      const user = userEvent.setup();
      const { onToggleStatus } = renderToolbar();

      await openMobileMenu(user);
      // Radix portals set pointer-events:none on the body, so drive the menu by keyboard (as
      // board.test.tsx does): ↓ lands on the submenu trigger, → opens it onto its first option.
      await user.keyboard('[ArrowDown][ArrowRight]');
      expect(
        await screen.findByRole('menuitemcheckbox', { name: 'Needs Refinement' }),
      ).toHaveFocus();

      await user.keyboard('[Enter]');

      expect(onToggleStatus).toHaveBeenCalledWith('needs_refinement');
    });

    it('leaves the trigger unhighlighted while every filter rests at its default', () => {
      renderToolbar();

      expect(screen.getByRole('button', { name: 'Board filters' })).not.toHaveClass(
        'bg-accent-teal/10',
      );
    });

    it.each([
      ['the status filter is narrowed', { isFiltering: true }],
      ['abandoned stories are shown', { showAbandoned: true }],
      ['archived epics are shown', { hasArchivedEpics: true, showArchived: true }],
    ])('highlights the trigger while %s', (_label, overrides) => {
      renderToolbar(overrides);

      // The folded-away controls carry their own teal treatment; the ⋯ inherits it so an
      // active filter is not invisible on a phone.
      expect(screen.getByRole('button', { name: 'Board filters' })).toHaveClass(
        'bg-accent-teal/10',
      );
    });
  });
});
