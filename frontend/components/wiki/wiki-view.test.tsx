import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { WikiPageRow } from '@/lib/types';
import {
  makeWikiPage,
  makeWikiSync,
  resetWikiFixtureClock,
  toWikiIndexRow,
  wikiFixtureSet,
} from '@/lib/wiki/fixtures';

import { WikiView } from './wiki-view';

// react-markdown and remark-gfm are pure ESM, which Jest's default transform leaves alone, so the
// real package throws on import. Mock the seam: the body's SOURCE is rendered as text, which is
// what these tests assert (that the right body reaches the renderer). The real rendering — link
// kinds, heading ids, a hash scroll — is pinned by the Playwright suite and the Storybook
// baselines, which run a real bundler. This mocks a dependency; it weakens no config.
jest.mock('react-markdown', () => ({
  __esModule: true,
  // The stand-in heading gives the hash-scroll test a target inside the body, where the view
  // looks for one.
  default: ({ children }: { children?: string }) => (
    <div data-testid="markdown">
      <span id="early-life" />
      {children}
    </div>
  ),
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

jest.mock('@/lib/api-client', () => ({
  fetchWikiPages: jest.fn(),
  fetchWikiPageBody: jest.fn(),
  searchWikiBodies: jest.fn(),
}));

// A pathname backed by a tiny store and driven by the pushState spy, so a click on an in-app link
// re-renders the view on its new route (see the react-testing-library skill).
const mockPathnameStore = {
  pathname: '/wiki',
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
}));

const mockFetchPages = jest.mocked(api.fetchWikiPages);
const mockFetchBody = jest.mocked(api.fetchWikiPageBody);

const NOW = new Date('2026-10-03T16:00:00.000Z');
const REPO = 'ac3charland/knowledge';

let FIXTURES: { pages: WikiPageRow[]; sync: ReturnType<typeof makeWikiSync> };

function fixture(path: string): WikiPageRow {
  const page = FIXTURES.pages.find((candidate) => candidate.path === path);
  if (page === undefined) throw new Error(`no fixture page ${path}`);
  return page;
}

function renderAt(
  pathname: string,
  wiki: NonNullable<Parameters<typeof renderWithProviders>[1]>['wiki'] = {},
) {
  mockPathnameStore.pathname = pathname;
  return renderWithProviders(<WikiView now={NOW} />, {
    wiki: {
      pages: FIXTURES.pages.map((page) => toWikiIndexRow(page)),
      sync: FIXTURES.sync,
      repo: REPO,
      ...wiki,
    },
  });
}

/** Answer every body read from the fixture set, the way the route would. */
function serveBodies() {
  mockFetchBody.mockImplementation((path) => {
    const page = fixture(path);
    return Promise.resolve({ path, blob_oid: page.blob_oid, body: page.body });
  });
}

let pushState: jest.SpyInstance;
let scrollTo: jest.SpyInstance;

beforeEach(() => {
  // jsdom has no layout to scroll; record the calls instead.
  scrollTo = jest.spyOn(globalThis, 'scrollTo').mockImplementation(() => {});
  resetWikiFixtureClock();
  FIXTURES = wikiFixtureSet();
  mockPathnameStore.pathname = '/wiki';
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  mockFetchPages.mockReturnValue(new Promise(() => {}));
  mockFetchBody.mockReturnValue(new Promise(() => {}));
  pushState = jest
    .spyOn(globalThis.history, 'pushState')
    .mockImplementation((_state, _unused, url) => {
      mockPathnameStore.set(new URL(String(url), 'http://localhost').pathname);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WikiView — the header', () => {
  it('counts the pages and dates the sync', () => {
    renderAt('/wiki');

    expect(screen.getByRole('heading', { level: 2, name: 'Wiki' })).toBeInTheDocument();
    expect(screen.getByText('7 pages · synced 2h ago')).toBeInTheDocument();
  });

  it('says how many pages the last run left, and that the last sync failed', () => {
    renderAt('/wiki', {
      sync: makeWikiSync({
        synced_at: '2026-10-01T16:00:00.000Z',
        pending: 12,
        last_error: 'GraphQL: rate limited',
        last_error_at: '2026-10-03T13:00:00.000Z',
      }),
    });

    expect(
      screen.getByText('7 pages · synced 2d ago · 12 pages still syncing'),
    ).toBeInTheDocument();
    const failure = screen.getByText(
      'The last sync failed 3h ago — showing the snapshot from 2d ago.',
    );
    expect(failure).toHaveClass('text-accent-amber');
  });

  it('shows no failure line once a later sync succeeded', () => {
    renderAt('/wiki', {
      sync: makeWikiSync({ last_error_at: '2026-10-03T13:00:00.000Z' }),
    });

    expect(screen.queryByText(/The last sync failed/)).not.toBeInTheDocument();
  });
});

describe('WikiView — the empty snapshot', () => {
  it('says nothing has synced yet, on any route', () => {
    renderAt('/wiki/concepts/habit-stacking', { pages: [], sync: null });

    expect(screen.getByText('0 pages · not synced yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing synced yet')).toBeInTheDocument();
    expect(
      screen.getByText("Pages appear here after the wiki's next push reaches Alfred."),
    ).toBeInTheDocument();
  });
});

describe('WikiView — the index and a section', () => {
  it("groups every page by section in the wiki's order, each heading with its count", () => {
    renderAt('/wiki');

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Concepts3', 'Entities1', 'Sources2', 'Questions1']);

    const concepts = screen.getByRole('region', { name: /Concepts/ });
    expect(
      within(concepts)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      "Forgetting curveEbbinghaus's decay of recall over time, and why spaced review flattens it.",
      'Habit loopCue, craving, response, reward — the four-step cycle behind every habit.',
      'Habit stackingAnchoring a new behaviour to an existing routine rather than a clock time.',
    ]);
    expect(within(concepts).getByRole('link', { name: /Habit stacking/ })).toHaveAttribute(
      'href',
      '/wiki/concepts/habit-stacking',
    );
  });

  it('skips an empty section on the index', () => {
    renderAt('/wiki', {
      pages: [toWikiIndexRow(fixture('wiki/concepts/habit-stacking.md'))],
    });

    expect(screen.getByRole('region', { name: /Concepts/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Entities/ })).not.toBeInTheDocument();
  });

  it('lists one section only on its own route', () => {
    renderAt('/wiki/sources');

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Sources2',
    ]);
    expect(screen.getByRole('link', { name: /Atomic Habits/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Habit stacking/ })).not.toBeInTheDocument();
  });

  it('says a section with no pages is empty', () => {
    renderAt('/wiki/questions', {
      pages: [toWikiIndexRow(fixture('wiki/concepts/habit-stacking.md'))],
    });

    expect(screen.getByText('No questions yet.')).toBeInTheDocument();
  });

  it('opens a page from its row, client-side', async () => {
    const user = userEvent.setup();
    renderAt('/wiki');

    await user.click(screen.getByRole('link', { name: /Habit stacking/ }));

    expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/habit-stacking');
    expect(screen.getByRole('heading', { level: 3, name: 'Habit stacking' })).toBeInTheDocument();
  });
});

describe('WikiView — not found', () => {
  it.each([
    ['an unknown section', '/wiki/elsewhere'],
    ['a page not in the index', '/wiki/concepts/not-yet'],
    ['a path too deep', '/wiki/concepts/habit-stacking/extra'],
  ])('shows the not-found state for %s', async (_label, pathname) => {
    const user = userEvent.setup();
    renderAt(pathname);

    expect(screen.getByText('No page at this path')).toBeInTheDocument();
    expect(
      screen.getByText('It may have been renamed or removed in the wiki.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to the wiki' }));
    expect(screen.getByRole('region', { name: /Concepts/ })).toBeInTheDocument();
  });
});

describe('WikiView — a page', () => {
  const STACKING = '/wiki/concepts/habit-stacking';

  it('draws the header from the index while the body loads', () => {
    renderAt(STACKING);

    // The arrow is decoration: the link's name is the section.
    expect(screen.getByRole('link', { name: 'Concepts' })).toHaveAttribute(
      'href',
      '/wiki/concepts',
    );
    expect(screen.getByText('Concept')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Habit stacking' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Anchoring a new behaviour to an existing routine rather than a clock time.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('habits')).toBeInTheDocument();
    expect(screen.getByText('behaviour')).toBeInTheDocument();
    expect(screen.getByText('Updated Oct 3, 2026')).toBeInTheDocument();
    expect(screen.getByText('Loading page…')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
  });

  it('renders the body once it arrives', async () => {
    serveBodies();
    renderAt(STACKING);

    expect(await screen.findByTestId('markdown')).toHaveTextContent(
      'A new habit survives when its cue is something you already do.',
    );
    expect(mockFetchBody).toHaveBeenCalledWith('wiki/concepts/habit-stacking.md');
    expect(screen.queryByText('Loading page…')).not.toBeInTheDocument();
  });

  it('offers a retry when the body fails to load, keeping the header', async () => {
    const user = userEvent.setup();
    mockFetchBody.mockRejectedValueOnce(new Error('offline'));
    renderAt(STACKING);

    expect(await screen.findByText("Couldn't load this page")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Habit stacking' })).toBeInTheDocument();

    serveBodies();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('markdown')).toHaveTextContent('A new habit survives');
    expect(mockFetchBody).toHaveBeenCalledTimes(2);
  });

  it('lists the sources as GitHub links labelled folder / file, anchors kept', () => {
    renderAt(STACKING);

    const sources = screen.getByRole('region', { name: 'Sources' });
    const excerpt = within(sources).getByRole('link', {
      name: '2026-10-01-atomic-habits / excerpts-2026-10-01.md#q-after-i-pour (opens in a new tab)',
    });
    expect(excerpt).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/blob/main/raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour`,
    );
    expect(excerpt).toHaveAttribute('target', '_blank');
    expect(excerpt).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      within(sources).getByRole('link', {
        name: '2026-10-03-why-habits-stick / picks-2026-10-03.md (opens in a new tab)',
      }),
    ).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/blob/main/raw/2026/2026-10-03-why-habits-stick/picks-2026-10-03.md`,
    );
  });

  it('links a folder source to its tree', () => {
    renderAt('/wiki/concepts/habit-loop');

    expect(
      within(screen.getByRole('region', { name: 'Sources' })).getByRole('link', {
        name: '2026 / 2026-10-01-atomic-habits (opens in a new tab)',
      }),
    ).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/tree/main/raw/2026/2026-10-01-atomic-habits`,
    );
  });

  it('shows a source as plain text when there is no repo to link to', () => {
    renderAt(STACKING, { repo: null });

    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(within(sources).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(sources).getByText('2026-10-01-atomic-habits / excerpts-2026-10-01.md#q-after-i-pour'),
    ).toHaveAttribute('title', 'Not in the wiki snapshot');
  });

  it('lists every page that links here, in index order', async () => {
    const user = userEvent.setup();
    renderAt(STACKING);

    const linkedFrom = screen.getByRole('region', { name: 'Linked from' });
    expect(
      within(linkedFrom)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/wiki/concepts/habit-loop',
      '/wiki/sources/atomic-habits',
      '/wiki/questions/how-long-to-form-a-habit',
    ]);

    await user.click(within(linkedFrom).getByRole('link', { name: /Atomic Habits/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'Atomic Habits' })).toBeInTheDocument();
  });

  it('says so when no page links here', () => {
    renderAt('/wiki/questions/how-long-to-form-a-habit');

    expect(screen.getByText('No other page links here yet.')).toBeInTheDocument();
  });

  it('leaves out the tag row and sources for a bare page', () => {
    const bare = toWikiIndexRow(
      makeWikiPage('wiki/entities/bare.md', { title: 'Bare', updated: null }),
    );
    renderAt('/wiki/entities/bare', { pages: [bare] });

    expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.getByText('Entity')).toBeInTheDocument();
  });

  it('opens a page at the top when its URL has no anchor', async () => {
    const user = userEvent.setup();
    renderAt(STACKING);
    scrollTo.mockClear();

    await user.click(
      within(screen.getByRole('region', { name: 'Linked from' })).getByRole('link', {
        name: /Atomic Habits/,
      }),
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Atomic Habits' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('scrolls to the URL anchor inside the body once it renders, never to the top', async () => {
    const scrolled = jest.fn();
    // jsdom has no layout, so scrollIntoView is absent; stand one in and read which element it
    // was called on.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrolled,
    });
    const withHeading = makeWikiPage('wiki/entities/clear.md', { title: 'Clear' });
    mockFetchBody.mockResolvedValue({
      path: withHeading.path,
      blob_oid: withHeading.blob_oid,
      body: 'x',
    });
    globalThis.history.replaceState(null, '', '/wiki/entities/clear#early-life');
    // The same id outside the page body: the lookup is scoped to the body, so this is never it.
    const decoy = document.createElement('h2');
    decoy.id = 'early-life';
    document.body.prepend(decoy);

    renderAt('/wiki/entities/clear', { pages: [toWikiIndexRow(withHeading)] });

    const body = await screen.findByTestId('markdown');
    await waitFor(() => {
      expect(scrolled).toHaveBeenCalledTimes(1);
    });
    expect(body).toContainElement(scrolled.mock.contexts[0] as HTMLElement);
    expect(scrolled.mock.contexts).not.toContain(decoy);
    expect(scrollTo).not.toHaveBeenCalled();
    decoy.remove();
    globalThis.history.replaceState(null, '', '/');
  });
});

describe('WikiView — navigation refetch', () => {
  it('re-reads the snapshot on every navigation within the module', async () => {
    // Let the first read settle, or the store's coalescing would swallow the second refresh()
    // whether or not the effect re-ran — indistinguishable from pathname dropped from its deps.
    mockFetchPages.mockResolvedValue({ pages: [], sync: null });
    const { rerender } = renderAt('/wiki');
    await waitFor(() => {
      expect(mockFetchPages).toHaveBeenCalledTimes(1);
    });

    mockPathnameStore.pathname = '/wiki/concepts';
    rerender(<WikiView now={NOW} />);

    await waitFor(() => {
      expect(mockFetchPages).toHaveBeenCalledTimes(2);
    });
  });
});
