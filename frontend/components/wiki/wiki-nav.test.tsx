import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { WikiNav } from './wiki-nav';

const mockPathname = jest.fn<string, []>(() => '/wiki');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const PAGES = [
  makeWikiPage('wiki/concepts/habit-stacking.md'),
  makeWikiPage('wiki/concepts/habit-loop.md'),
  makeWikiPage('wiki/entities/james-clear.md'),
  makeWikiPage('wiki/sources/atomic-habits.md'),
].map((page) => toWikiIndexRow(page));

describe('WikiNav', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/wiki');
    jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
  });

  it("lists the index and the four sections, in the wiki's own order, with their hrefs", () => {
    renderWithProviders(<WikiNav />);

    const nav = screen.getByRole('navigation', { name: 'Wiki' });
    const links = [...nav.querySelectorAll('a')].map((link) => [
      link.textContent,
      link.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['All pages', '/wiki'],
      ['Concepts', '/wiki/concepts'],
      ['Entities', '/wiki/entities'],
      ['Sources', '/wiki/sources'],
      ['Questions', '/wiki/questions'],
    ]);
  });

  it("shows each section's page count, and nothing at zero", () => {
    renderWithProviders(<WikiNav />, { wiki: { pages: PAGES } });

    // The count's accessible name ("4 pages") joins the link's own name, so the query matches on
    // the visible label's prefix rather than the whole (now longer) accessible name.
    expect(screen.getByRole('link', { name: /^All pages/ })).toHaveTextContent('All pages4');
    expect(screen.getByRole('link', { name: /^Concepts/ })).toHaveTextContent('Concepts2');
    expect(screen.getByRole('link', { name: /^Entities/ })).toHaveTextContent('Entities1');
    expect(screen.getByRole('link', { name: /^Sources/ })).toHaveTextContent('Sources1');
    expect(screen.getByRole('link', { name: 'Questions' })).toHaveTextContent(/^Questions$/);
  });

  it('gives a nonzero count its own accessible reading, as real text rather than aria-label', () => {
    renderWithProviders(<WikiNav />, { wiki: { pages: PAGES } });

    // Real text, not `aria-label` on a role-less span (ARIA-prohibited, and it would replace
    // rather than extend the link's own accessible name) — so the digits and the sr-only suffix
    // both land in the link's computed name.
    const allPages = screen.getByRole('link', { name: 'All pages 4 pages' });
    const concepts = screen.getByRole('link', { name: 'Concepts 2 pages' });
    expect(allPages.querySelector('[aria-label]')).toBeNull();
    expect(concepts.querySelector('[aria-label]')).toBeNull();
  });

  it('highlights the link for the current route only', () => {
    mockPathname.mockReturnValue('/wiki/entities');
    renderWithProviders(<WikiNav />);

    expect(screen.getByRole('link', { name: 'Entities' })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: 'All pages' })).not.toHaveClass('bg-secondary');
  });

  it("highlights a section's link on its own page routes too, never 'All pages'", () => {
    mockPathname.mockReturnValue('/wiki/entities/james-clear');
    renderWithProviders(<WikiNav />);

    expect(screen.getByRole('link', { name: 'Entities' })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: 'All pages' })).not.toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: 'Concepts' })).not.toHaveClass('bg-secondary');
  });

  it('calls onClose when a link is clicked', () => {
    const onClose = jest.fn();
    renderWithProviders(<WikiNav onClose={onClose} />);

    screen.getByRole('link', { name: 'Sources' }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
