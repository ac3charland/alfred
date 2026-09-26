import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { WikiSearchHit } from '@/lib/types';
import { resetWikiFixtureClock, toWikiIndexRow, wikiFixtureSet } from '@/lib/wiki/fixtures';

import { WikiView } from './wiki-view';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

jest.mock('@/lib/api-client', () => ({
  fetchWikiPages: jest.fn(),
  fetchWikiPageBody: jest.fn(),
  searchWikiBodies: jest.fn(),
}));

const mockPathname = jest.fn<string, []>(() => '/wiki');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const mockFetchPages = jest.mocked(api.fetchWikiPages);
const mockSearch = jest.mocked(api.searchWikiBodies);

const NOW = new Date('2026-10-03T16:00:00.000Z');

const BRAIN_RULES_HIT: WikiSearchHit = {
  path: 'wiki/sources/brain-rules.md',
  snippet: 'Medina argues that \u0002forgetting\u0003 is the brain pruning',
  rank: 0.25,
};
const CURVE_HIT: WikiSearchHit = {
  path: 'wiki/concepts/forgetting-curve.md',
  snippet: 'Recall decays',
  rank: 0.5,
};

/** A promise and the function that settles it, for an answer the test releases by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      settle?.(value);
    },
  };
}

function renderAt(pathname = '/wiki') {
  resetWikiFixtureClock();
  const { pages, sync } = wikiFixtureSet();
  mockPathname.mockReturnValue(pathname);
  renderWithProviders(<WikiView now={NOW} />, {
    wiki: { pages: pages.map((page) => toWikiIndexRow(page)), sync, repo: 'ac3charland/knowledge' },
  });
  return screen.getByRole('searchbox', { name: 'Search the wiki' });
}

beforeEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  mockFetchPages.mockReturnValue(new Promise(() => {}));
  mockSearch.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the Wiki search', () => {
  it('lists title and summary matches instantly, each with its section chip', async () => {
    const user = userEvent.setup();
    const box = renderAt();
    expect(box).toHaveAttribute('placeholder', 'Search the wiki');

    await user.type(box, 'habit');

    const titles = screen.getByRole('region', { name: 'Titles & summaries' });
    const rows = within(titles).getAllByRole('link');
    // Title prefixes first, then title substrings (all updated the same day, so in index order),
    // then summary or tag matches.
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/wiki/concepts/habit-loop',
      '/wiki/concepts/habit-stacking',
      '/wiki/sources/atomic-habits',
      '/wiki/questions/how-long-to-form-a-habit',
      '/wiki/entities/james-clear',
    ]);
    expect(within(rows[0] ?? titles).getByText('Concept')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Concepts/ })).not.toBeInTheDocument();
  });

  it('shows the body search pending, with a spinner, while it runs', async () => {
    const user = userEvent.setup();
    const box = renderAt();

    await user.type(box, 'forgetting');

    const inText = screen.getByRole('region', { name: 'In page text' });
    expect(within(inText).getByText('Searching page text…')).toBeInTheDocument();
    expect(within(inText).getByRole('status', { name: 'Searching page text' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Titles & summaries' })).getByRole('link', {
        name: /Forgetting curve/,
      }),
    ).toBeInTheDocument();
  });

  it('lists body matches with the matched words marked, leaving out pages already listed', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([CURVE_HIT, BRAIN_RULES_HIT]);
    const box = renderAt();

    await user.type(box, 'forgetting');

    const inText = await screen.findByRole('region', { name: 'In page text' });
    const row = await within(inText).findByRole('link', { name: /Brain Rules/ });
    expect(row).toHaveAttribute('href', '/wiki/sources/brain-rules');
    expect(within(row).getByText('Source')).toBeInTheDocument();
    expect(within(row).getByText('forgetting').tagName).toBe('MARK');
    expect(row).toHaveTextContent('Medina argues that forgetting is the brain pruning');
    // The curve is a title match, so it appears once, above — not again here.
    expect(
      within(inText).queryByRole('link', { name: /Forgetting curve/ }),
    ).not.toBeInTheDocument();
    expect(mockSearch).toHaveBeenCalledWith('forgetting');
  });

  it('searches the whole wiki from a section view', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([BRAIN_RULES_HIT]);
    const box = renderAt('/wiki/concepts');

    await user.type(box, 'forgetting');

    expect(await screen.findByRole('link', { name: /Brain Rules/ })).toHaveAttribute(
      'href',
      '/wiki/sources/brain-rules',
    );
  });

  it('waits for typing to pause 250ms, then searches once for the whole query', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const box = renderAt();

    await user.type(box, 'forget');
    expect(mockSearch).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(249);
    });
    expect(mockSearch).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith('forget');
  });

  it('never searches bodies for a single character', async () => {
    const user = userEvent.setup();
    const box = renderAt();

    await user.type(box, 'h');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(mockSearch).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'In page text' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Titles & summaries' })).toBeInTheDocument();
  });

  it('says the body search failed and keeps the title matches', async () => {
    const user = userEvent.setup();
    mockSearch.mockRejectedValue(new Error('500'));
    const box = renderAt();

    await user.type(box, 'forgetting');

    expect(await screen.findByText("Couldn't search page text")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Forgetting curve/ })).toBeInTheDocument();
  });

  it('says nothing matches when neither group finds a page', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([]);
    const box = renderAt();

    await user.type(box, 'zettelkasten');

    expect(await screen.findByText('No pages match “zettelkasten”')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Titles & summaries' })).not.toBeInTheDocument();
  });

  it('says nothing matches for a single character no title holds', async () => {
    const user = userEvent.setup();
    const box = renderAt();

    await user.type(box, 'z');

    expect(screen.getByText('No pages match “z”')).toBeInTheDocument();
  });

  it('never shows an answer for an earlier query', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const first = deferred<WikiSearchHit[]>();
    mockSearch.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
    const box = renderAt();

    await user.type(box, 'medina');
    act(() => {
      jest.advanceTimersByTime(250);
    });
    await user.type(box, 'x');
    act(() => {
      jest.advanceTimersByTime(250);
    });
    await act(async () => {
      first.resolve([BRAIN_RULES_HIT]);
      await Promise.resolve();
    });

    expect(mockSearch).toHaveBeenLastCalledWith('medinax');
    expect(screen.queryByRole('link', { name: /Brain Rules/ })).not.toBeInTheDocument();
    expect(screen.getByText('Searching page text…')).toBeInTheDocument();
  });

  it('returns to the list when the box is cleared', async () => {
    const user = userEvent.setup();
    const box = renderAt();

    await user.type(box, 'habit');
    await user.clear(box);

    expect(screen.getByRole('region', { name: /Concepts/ })).toBeInTheDocument();
  });
});
