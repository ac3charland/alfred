import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeCommAccount } from '@/lib/comms/fixtures';
import {
  READER_HEALTH_FIXTURE_NOW,
  makeReaderHealth,
  makeReaderOverview,
  makeReaderPost,
  readerFixtureSet,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type { ReaderOverview, ReaderPost, ReaderPostListItem } from '@/lib/types';

import { ReadingListView } from './reading-list-view';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

/** The list read's own shape — every fixture post has to drop `text` before rendering. */
function withoutText(post: ReaderPost): ReaderPostListItem {
  const { text: _text, ...listItem } = post;
  return listItem;
}

/** The instant every row's dates are read against, so the list is assertable at all. */
const NOW = new Date(2026, 8, 18, 9, 0);

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('ReadingListView — heading', () => {
  it('reads "N to read" and wears the reader accent', () => {
    const { posts } = readerFixtureSet();
    renderReader(
      <ReadingListView />,
      posts.map((post) => withoutText(post)),
    );

    expect(screen.getByText('Reader')).toBeInTheDocument();
    // Six fixture posts, none archived — every unarchived post counts, whatever its state.
    expect(screen.getByText('6 to read')).toBeInTheDocument();
  });

  it('reads "Nothing to read" at zero', () => {
    renderReader(<ReadingListView />, []);
    expect(screen.getByText('Nothing to read')).toBeInTheDocument();
  });
});

describe('ReadingListView — empty state', () => {
  it('shows the resting empty state with no posts', () => {
    renderReader(<ReadingListView />, []);

    expect(screen.getByText('Nothing new to read.')).toBeInTheDocument();
    expect(
      screen.getByText('Newsletters from your publications land here as they arrive, summarised.'),
    ).toBeInTheDocument();
  });

  it('renders rows instead of the empty state once posts exist', () => {
    const { publication } = readerFixtureSet();
    const post = withoutText(makeReaderPost(publication.id, { title: 'A post to read' }));
    renderReader(<ReadingListView />, [post]);

    expect(screen.queryByText('Nothing new to read.')).not.toBeInTheDocument();
    expect(screen.getByText('A post to read')).toBeInTheDocument();
  });
});

describe('ReadingListView — rows', () => {
  it('renders newest arrival first', () => {
    const { publication } = readerFixtureSet();
    const older = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-older',
        title: 'Older post',
        received_at: '2026-09-14T09:00:00.000Z',
      }),
    );
    const newer = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-newer',
        title: 'Newer post',
        received_at: '2026-09-16T09:00:00.000Z',
      }),
    );
    renderReader(<ReadingListView />, [older, newer]);

    const titles = screen.getAllByText(/post$/).map((el) => el.textContent);
    expect(titles).toEqual(['Newer post', 'Older post']);
  });

  it('a failed archive restores the row to the list', async () => {
    const user = userEvent.setup();
    const { publication } = readerFixtureSet();
    const post = withoutText(makeReaderPost(publication.id, { id: 'p-1', title: 'Still here' }));
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    renderReader(<ReadingListView />, [post]);

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    const wrapper = screen.getByTestId('reader-row-collapse');
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(wrapper, event);

    expect(await screen.findByText('Still here')).toBeInTheDocument();
    expect(screen.getByText("Couldn't archive that post")).toBeInTheDocument();
  });

  it('a successful archive removes the row and drops the count', async () => {
    const user = userEvent.setup();
    const { publication } = readerFixtureSet();
    const post = withoutText(makeReaderPost(publication.id, { id: 'p-1', title: 'Going away' }));
    mockApi.patchReaderPost.mockResolvedValue({
      ...post,
      archived_at: '2026-09-18T09:00:00.000Z',
    });
    renderReader(<ReadingListView />, [post]);
    expect(screen.getByText('1 to read')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    const wrapper = screen.getByTestId('reader-row-collapse');
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(wrapper, event);

    expect(await screen.findByText('Nothing to read')).toBeInTheDocument();
    expect(screen.queryByText('Going away')).not.toBeInTheDocument();
  });
});

describe('ReadingListView — the clock', () => {
  it('dates every row against the `now` it is handed, not the wall clock', () => {
    const { publication } = readerFixtureSet();
    const thisYear = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-this-year',
        title: 'Arrived in the pinned year',
        received_at: '2030-09-16T14:00:00.000Z',
      }),
    );
    const lastYear = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-last-year',
        title: 'Arrived the year before',
        received_at: '2029-09-14T14:00:00.000Z',
      }),
    );
    renderReader(<ReadingListView now={new Date('2030-09-18T09:00:00.000Z')} />, [
      thisYear,
      lastYear,
    ]);

    // The year is spelled out only for a post that did not arrive in `now`'s year, so a row
    // reading a bare "Sep 16" proves the pinned instant reached it rather than the wall clock.
    expect(screen.getByText(/^Sep 16 ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Sep 14, 2029 ·/)).toBeInTheDocument();
  });
});

describe('ReadingListView — the health surface', () => {
  const HEALTH_NOW = new Date(READER_HEALTH_FIXTURE_NOW);

  /** An instant `minutes` before the pinned health instant, as the columns store it. */
  function ago(minutes: number): string {
    return new Date(HEALTH_NOW.getTime() - minutes * 60 * 1000).toISOString();
  }

  const LIVE_ACCOUNT = makeCommAccount('Personal', {
    key: 'gmail-personal',
    last_seen_at: ago(1),
  });

  it('carries the dots beside the heading and stays quiet when everything works', () => {
    renderReader(<ReadingListView now={HEALTH_NOW} />, [], {
      health: makeReaderHealth('live', {}, HEALTH_NOW),
      account: LIVE_ACCOUNT,
    });

    expect(screen.getByTestId('reader-health-dots')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders exactly one banner, above the heading, when several states are bad at once', () => {
    renderReader(<ReadingListView now={HEALTH_NOW} />, [], {
      health: makeReaderHealth(
        'ceiling',
        { last_success_at: ago(200), last_error_at: ago(48) },
        HEALTH_NOW,
      ),
      account: {
        ...LIVE_ACCOUNT,
        last_seen_at: ago(600),
        last_error_at: ago(120),
        last_error: 'invalid_grant',
      },
    });

    const banners = screen.getAllByRole('status');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent('Gmail is not delivering.');
    // Above the heading in document order, not beside it.
    expect(banners[0]?.compareDocumentPosition(screen.getByText('Reader'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('counts the posts the spent daily budget is holding', () => {
    const { publication } = readerFixtureSet();
    const claimed = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-waiting',
        summary_state: 'pending',
        word_count: 900,
        created_at: ago(200),
      }),
    );

    renderReader(<ReadingListView now={HEALTH_NOW} />, [claimed], {
      health: makeReaderHealth('ceiling', {}, HEALTH_NOW),
      account: LIVE_ACCOUNT,
    });

    expect(screen.getByRole('status')).toHaveTextContent('— 1 claimed post waits for tomorrow.');
  });

  it('reads the summariser off every post the store holds, archived ones included', () => {
    const { publication } = readerFixtureSet();
    // The only summary that has landed is on a post the owner has already archived — the
    // summariser is working, and a stall read off the visible list alone would miss it.
    const archivedSummary = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-archived-done',
        summary_state: 'done',
        word_count: 900,
        summarized_at: ago(2),
        archived_at: ago(1),
      }),
    );
    const claimed = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-waiting',
        summary_state: 'pending',
        word_count: 900,
        created_at: ago(90),
      }),
    );

    renderReader(<ReadingListView now={HEALTH_NOW} />, [claimed, archivedSummary], {
      health: makeReaderHealth('live', { last_success_at: ago(200) }, HEALTH_NOW),
      account: LIVE_ACCOUNT,
    });

    expect(screen.getByRole('img', { name: 'summariser · live' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('counts an archived post that is still claimed among the ones the ceiling holds', () => {
    const { publication } = readerFixtureSet();
    const archivedClaim = withoutText(
      makeReaderPost(publication.id, {
        id: 'p-archived-pending',
        summary_state: 'pending',
        word_count: 900,
        created_at: ago(200),
        archived_at: ago(1),
      }),
    );

    renderReader(<ReadingListView now={HEALTH_NOW} />, [archivedClaim], {
      health: makeReaderHealth('ceiling', {}, HEALTH_NOW),
      account: LIVE_ACCOUNT,
    });

    expect(screen.getByRole('status')).toHaveTextContent('— 1 claimed post waits for tomorrow.');
  });
});

// ---------------------------------------------------------------------------------------------
// Selection and the keyboard.
// ---------------------------------------------------------------------------------------------

/** A done post with an overview, at the arrival the caller pins. */
function donePost(
  id: string,
  title: string,
  receivedAt: string,
  overrides: Partial<Omit<ReaderPost, 'overview'>> & { overview?: ReaderOverview | null } = {},
): ReaderPostListItem {
  const { publication } = readerFixtureSet();
  return withoutText(
    makeReaderPost(publication.id, {
      id,
      title,
      received_at: receivedAt,
      canonical_url: `https://example.test/${id}`,
      word_count: 900,
      summary_state: 'done',
      gist: `The gist of ${title}.`,
      overview: makeReaderOverview(),
      ...overrides,
    }),
  );
}

/** Three rows, newest first: Alpha, Beta, Gamma. */
function threeRows(): ReaderPostListItem[] {
  return [
    donePost('p-a', 'Alpha', '2026-09-16T09:00:00.000Z'),
    donePost('p-b', 'Beta', '2026-09-15T09:00:00.000Z'),
    donePost('p-c', 'Gamma', '2026-09-14T09:00:00.000Z'),
  ];
}

/** One row, so a verb key has exactly one row it could reach. */
function oneRow(
  overrides: Partial<Omit<ReaderPost, 'overview'>> & { overview?: ReaderOverview | null } = {},
): ReaderPostListItem[] {
  return [donePost('p-1', 'Alpha', '2026-09-16T09:00:00.000Z', overrides)];
}

/** The titles of the rows the keyboard is pointing at, in the order they are drawn. */
function selectedTitles(): string[] {
  return screen
    .getAllByTestId('reader-row')
    .filter((row) => row.dataset['selected'] === 'true')
    .map((row) => row.querySelector('p')?.textContent ?? '');
}

/** The drawn row whose title says `title`, so nothing has to be indexed by position. */
function rowFor(title: string): HTMLElement {
  const found = screen
    .getAllByTestId('reader-row')
    .find((row) => row.querySelector('p')?.textContent === title);
  if (found === undefined) throw new Error(`No row titled ${title} is on screen`);
  return found;
}

/** The exit wrapper around the row titled `title` — jsdom plays no transitions, so end it here. */
function endExitFor(title: string): void {
  const wrapper = rowFor(title).closest('[data-testid="reader-row-collapse"]');
  if (wrapper === null) throw new Error(`The row titled ${title} has no exit wrapper`);
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
  fireEvent(wrapper, event);
}

describe('ReadingListView — selection', () => {
  it('lands on the first row when nothing is selected yet, whichever direction', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, threeRows());

    await user.keyboard('{ArrowUp}');

    expect(selectedTitles()).toEqual(['Alpha']);
  });

  it('walks down with j and back up with k, holding at the ends', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, threeRows());

    await user.keyboard('j');
    expect(selectedTitles()).toEqual(['Alpha']);

    await user.keyboard('j');
    expect(selectedTitles()).toEqual(['Beta']);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selectedTitles()).toEqual(['Gamma']);

    await user.keyboard('k');
    expect(selectedTitles()).toEqual(['Beta']);

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(selectedTitles()).toEqual(['Alpha']);
  });

  it('drops the selection on Escape', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, threeRows());

    await user.keyboard('j');
    await user.keyboard('{Escape}');

    expect(selectedTitles()).toEqual([]);
  });

  it('selects a row and toggles its overview when the card is clicked', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, threeRows());

    await user.click(screen.getByText('Alpha'));

    expect(selectedTitles()).toEqual(['Alpha']);
    expect(screen.getAllByRole('heading', { name: 'Novel ideas' })).toHaveLength(1);
  });

  it('never points at more than one row at a time', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, threeRows());

    await user.keyboard('jj');

    expect(selectedTitles()).toHaveLength(1);
  });
});

describe('ReadingListView — the verb keys', () => {
  it('opens the selected row through its own Open link, stamping opened_at', async () => {
    const user = userEvent.setup();
    const posts = oneRow();
    mockApi.patchReaderPost.mockResolvedValue(
      posts[0] ?? donePost('p-1', 'Alpha', NOW.toISOString()),
    );
    renderReader(<ReadingListView now={NOW} />, posts);
    const opened = jest.fn();
    screen.getByRole('link', { name: 'Open' }).addEventListener('click', (event) => {
      // jsdom refuses to navigate; the point is that the row's real anchor was the thing clicked.
      event.preventDefault();
      opened();
    });

    await user.keyboard('j');
    await user.keyboard('o');

    expect(opened).toHaveBeenCalledTimes(1);
    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { opened: true });
  });

  it('does nothing on o when the row has nowhere to point', async () => {
    const user = userEvent.setup();
    renderReader(
      <ReadingListView now={NOW} />,
      oneRow({ canonical_url: null, rfc822_message_id: null }),
    );

    await user.keyboard('j');
    await user.keyboard('o');

    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();
  });

  it('toggles the selected row’s overview on v', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, oneRow());

    await user.keyboard('j');
    await user.keyboard('v');
    expect(screen.getByRole('heading', { name: 'Novel ideas' })).toBeInTheDocument();

    await user.keyboard('v');
    expect(screen.queryByRole('heading', { name: 'Novel ideas' })).not.toBeInTheDocument();
  });

  it('leaves a row with no panel alone on v', async () => {
    const user = userEvent.setup();
    // No overview AND nothing to put in a footer: an unsummarised body means no stamp and no
    // re-run verb, so there is genuinely no panel for the key to open.
    renderReader(<ReadingListView now={NOW} />, oneRow({ overview: null, word_count: 0 }));

    await user.keyboard('j');
    await user.keyboard('v');

    expect(screen.queryByRole('button', { name: /overview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Novel ideas' })).not.toBeInTheDocument();
  });

  it('archives the selected row on e and moves the selection to the next one', async () => {
    const user = userEvent.setup();
    const posts = [
      donePost('p-a', 'Alpha', '2026-09-16T09:00:00.000Z'),
      donePost('p-b', 'Beta', '2026-09-15T09:00:00.000Z'),
    ];
    mockApi.patchReaderPost.mockResolvedValue({
      ...donePost('p-a', 'Alpha', '2026-09-16T09:00:00.000Z'),
      archived_at: '2026-09-18T09:00:00.000Z',
    });
    renderReader(<ReadingListView now={NOW} />, posts);

    await user.keyboard('j');
    await user.keyboard('e');
    // The selection moves as the exit STARTS, before the write commits.
    expect(selectedTitles()).toEqual(['Beta']);

    endExitFor('Alpha');

    expect(await screen.findByText('1 to read')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-a', { archived: true });
    expect(selectedTitles()).toEqual(['Beta']);
  });

  it('clears the selection when the last row is archived', async () => {
    const user = userEvent.setup();
    const posts = oneRow();
    mockApi.patchReaderPost.mockResolvedValue({
      ...donePost('p-1', 'Alpha', '2026-09-16T09:00:00.000Z'),
      archived_at: '2026-09-18T09:00:00.000Z',
    });
    renderReader(<ReadingListView now={NOW} />, posts);

    await user.keyboard('j');
    await user.keyboard('e');

    expect(selectedTitles()).toEqual([]);
  });
});

describe('ReadingListView — when a keystroke is not a verb', () => {
  it('ignores keys typed into a text field', async () => {
    const user = userEvent.setup();
    renderReader(
      <>
        <input aria-label="Somewhere to type" />
        <ReadingListView now={NOW} />
      </>,
      oneRow(),
    );

    await user.click(screen.getByLabelText('Somewhere to type'));
    await user.keyboard('je');

    expect(selectedTitles()).toEqual([]);
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();
  });

  it('ignores a chord — those belong to the browser and the command palette', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, oneRow());

    await user.keyboard('{Meta>}j{/Meta}');
    expect(selectedTitles()).toEqual([]);

    await user.keyboard('j');
    await user.keyboard('{Control>}e{/Control}');
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// The keyboard hints.
// ---------------------------------------------------------------------------------------------

/** The exact treatment a hint wears — the search box's, from `md` rather than from `sm`. */
const HINT_CLASS =
  'hidden md:inline-flex rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground';

/** Every key hint currently on screen, in document order. */
function hints(): HTMLElement[] {
  return screen.queryAllByText(/^[oev]$/, { selector: 'kbd' });
}

/** A failed row: it carries a Retry summary verb, which deliberately has no key. */
function failedRow(): ReaderPostListItem[] {
  return oneRow({ summary_state: 'failed', summarize_attempts: 3, overview: null });
}

describe('ReadingListView — the keyboard hints', () => {
  it('draws no hints until a row is selected', () => {
    renderReader(<ReadingListView now={NOW} />, threeRows());
    expect(hints()).toHaveLength(0);
  });

  it('hints the three verb keys on the selected row, and only there', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, threeRows());

    await user.keyboard('j');

    expect(hints().map((hint) => hint.textContent)).toEqual(['o', 'v', 'e']);
    for (const hint of hints()) {
      expect(rowFor('Alpha')).toContainElement(hint);
      expect(hint).toHaveAttribute('class', HINT_CLASS);
      // Decoration, not part of the verb: the button still reads as its own label.
      expect(hint).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('never hints the re-run verb, which has no key', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, failedRow());

    await user.keyboard('j');

    expect(hints().map((hint) => hint.textContent)).toEqual(['o', 'e']);
    expect(screen.getByRole('button', { name: 'Retry summary' })).toHaveTextContent(
      /^Retry summary$/,
    );
  });

  it('keeps every verb tappable where the hints are hidden', async () => {
    const user = userEvent.setup();
    renderReader(<ReadingListView now={NOW} />, failedRow());

    await user.keyboard('j');

    // jsdom answers no media query, so the breakpoint itself is pinned by the class assertion
    // above; what matters here is that hiding the hints hides no verb with them.
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});
