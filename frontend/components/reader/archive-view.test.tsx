import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderOverview, makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import { ARCHIVE_READ_LIMIT, useArchivedPosts, useReaderActions } from '@/lib/stores/reader-store';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { ArchiveView } from './archive-view';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

const NOW = new Date(2026, 8, 18, 9, 0);
/** The line the view draws under a read that came back at its ceiling. */
const SLICE_LINE = 'Showing the 200 most recent posts the archive read returned';
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

/** An archived post as the list read hands it over — no `text`, and an `archived_at` stamp. */
function archived(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, {
    archived_at: '2026-09-18T08:00:00.000Z',
    ...overrides,
  });
  return listItem;
}

/**
 * jsdom plays no CSS transitions, so fire the exit wrapper's own transitionend by hand. Fired at
 * every drawn row: a row that is not exiting ignores it, so the helper needs no index.
 */
function endExit(): void {
  for (const wrapper of screen.getAllByTestId('reader-row-collapse')) {
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
    fireEvent(wrapper, event);
  }
}

/** The drawn row whose title says `title`, so nothing has to be indexed by position. */
function rowFor(title: string): HTMLElement {
  const found = screen
    .getAllByTestId('reader-row')
    .find((row) => row.querySelector('p')?.textContent === title);
  if (found === undefined) throw new Error(`No row titled ${title} is on screen`);
  return found;
}

/**
 * A test-only control that empties the archive in one gesture. The slice line only ever appears
 * over a read that came back at its ceiling, so reaching an archive that is both full and empty
 * means putting two hundred posts back — which through the rows' own verb is two
 * hundred clicks, and through the store is this.
 */
function UnarchiveEverything() {
  const posts = useArchivedPosts();
  const { unarchive } = useReaderActions();
  return (
    <button
      type="button"
      onClick={() => {
        for (const post of posts) void unarchive(post.id);
      }}
    >
      unarchive everything
    </button>
  );
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
  mockApi.fetchReaderPosts.mockResolvedValue([]);
});

describe('ArchiveView — the heading', () => {
  it('names the segment and says what it holds', async () => {
    renderReader(<ArchiveView now={NOW} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Archive' })).toBeInTheDocument();
    expect(
      screen.getByText("Everything you've skimmed and put away. Unarchive to bring one back."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalled();
    });
  });
});

describe('ArchiveView — the read', () => {
  it('asks for the archived scope on first visit, at its ceiling', async () => {
    renderReader(<ArchiveView now={NOW} />);

    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledWith({
        scope: 'archived',
        limit: ARCHIVE_READ_LIMIT,
      });
    });
  });

  it('draws what came back, newest arrival first', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([
      archived({ id: 'p-older', title: 'Older post', received_at: '2026-09-09T09:00:00.000Z' }),
      archived({ id: 'p-newer', title: 'Newer post', received_at: '2026-09-12T09:00:00.000Z' }),
    ]);
    renderReader(<ArchiveView now={NOW} />);

    const titles = await screen.findAllByText(/post$/);
    expect(titles.map((element) => element.textContent)).toEqual(['Newer post', 'Older post']);
  });

  it('says it is showing a slice only when the read came back at its ceiling', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue(
      Array.from({ length: ARCHIVE_READ_LIMIT }, (_, index) =>
        archived({ id: `p-${String(index)}`, title: `Post ${String(index)}` }),
      ),
    );
    renderReader(<ArchiveView now={NOW} />);

    expect(await screen.findByText(SLICE_LINE)).toBeInTheDocument();
  });

  it('says nothing about a slice when the archive fits', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([archived({ id: 'p-1', title: 'The only one' })]);
    renderReader(<ArchiveView now={NOW} />);

    expect(await screen.findByText('The only one')).toBeInTheDocument();
    expect(screen.queryByText(SLICE_LINE)).not.toBeInTheDocument();
  });

  it('drops the slice line once the rows it described have all been put back', async () => {
    const user = userEvent.setup();
    const shape = archived({ id: 'p-0', title: 'Post 0' });
    mockApi.fetchReaderPosts.mockResolvedValue(
      Array.from({ length: ARCHIVE_READ_LIMIT }, (_, index) =>
        archived({ id: `p-${String(index)}`, title: `Post ${String(index)}` }),
      ),
    );
    mockApi.patchReaderPost.mockImplementation((id) =>
      Promise.resolve({ ...shape, id, archived_at: null }),
    );
    renderReader(
      <>
        <ArchiveView now={NOW} />
        <UnarchiveEverything />
      </>,
    );
    expect(await screen.findByText(SLICE_LINE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'unarchive everything' }));

    // The line describes rows; with none left it would be claiming to show 200 of nothing,
    // right beside the empty state.
    await waitFor(() => {
      expect(screen.queryByText(SLICE_LINE)).not.toBeInTheDocument();
    });
    expect(screen.getByText('Nothing archived yet.')).toBeInTheDocument();
  });
});

describe('ArchiveView — a read that never answered', () => {
  it('says so, rather than resting on the empty state', async () => {
    mockApi.fetchReaderPosts.mockRejectedValue(new Error('offline'));
    renderReader(<ArchiveView now={NOW} />);

    expect(await screen.findByText("Couldn't load the archive.")).toBeInTheDocument();
    expect(screen.queryByText('Nothing archived yet.')).not.toBeInTheDocument();
  });

  it('reads again when Try again is pressed, and draws what comes back', async () => {
    const user = userEvent.setup();
    mockApi.fetchReaderPosts
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([archived({ id: 'p-1', title: 'Back from the archive' })]);
    renderReader(<ArchiveView now={NOW} />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Back from the archive')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the archive.")).not.toBeInTheDocument();
  });
});

describe('ArchiveView — the empty state', () => {
  it('waits for the read before claiming the archive is empty', () => {
    // The read is still in the air: an empty list means "not here yet", not "nothing archived".
    mockApi.fetchReaderPosts.mockReturnValue(new Promise(() => {}));
    renderReader(<ArchiveView now={NOW} />);

    expect(screen.queryByText('Nothing archived yet.')).not.toBeInTheDocument();
  });

  it('shows it once the read lands with nothing in it', async () => {
    renderReader(<ArchiveView now={NOW} />);

    expect(await screen.findByText('Nothing archived yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Archive a post from the reading list and it lands here.'),
    ).toBeInTheDocument();
  });
});

describe('ArchiveView — the rows', () => {
  const POST = archived({
    id: 'p-1',
    title: 'Why every forecasting tournament converges on the same three people',
    author: 'Second Thoughts',
    canonical_url: 'https://secondthoughts.substack.com/p/forecasting-tournaments',
    word_count: 2400,
    summary_state: 'done',
    gist: 'A selection-effects argument.',
    overview: makeReaderOverview(),
  });

  it('offers Open and Unarchive, never Archive', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([POST]);
    renderReader(<ArchiveView now={NOW} />);

    expect(await screen.findByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('expands into the overview like the reading list does', async () => {
    const user = userEvent.setup();
    mockApi.fetchReaderPosts.mockResolvedValue([POST]);
    renderReader(<ArchiveView now={NOW} />);

    await user.click(await screen.findByRole('button', { name: 'Overview' }));

    expect(screen.getByRole('heading', { name: 'Novel ideas' })).toBeInTheDocument();
  });

  it('puts a post back on the reading list when Unarchive is clicked', async () => {
    const user = userEvent.setup();
    mockApi.fetchReaderPosts.mockResolvedValue([POST]);
    mockApi.patchReaderPost.mockResolvedValue({ ...POST, archived_at: null });
    renderReader(<ArchiveView now={NOW} />);

    await user.click(await screen.findByRole('button', { name: 'Unarchive' }));
    endExit();

    await waitFor(() => {
      expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { archived: false });
    });
  });

  it('lets the keyboard reach a row again once its unarchive has rolled back', async () => {
    const user = userEvent.setup();
    const above = archived({
      id: 'p-above',
      title: 'The one above',
      received_at: '2026-09-12T09:00:00.000Z',
    });
    const below = archived({
      id: 'p-below',
      title: 'The one below',
      received_at: '2026-09-11T09:00:00.000Z',
    });
    mockApi.fetchReaderPosts.mockResolvedValue([above, below]);
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    renderReader(<ArchiveView now={NOW} />);
    await screen.findByText('The one above');

    // Unarchiving the top row selects it and moves the selection to the row below as it leaves.
    await user.click(within(rowFor('The one above')).getByRole('button', { name: 'Unarchive' }));
    endExit();
    expect(await screen.findByText("Couldn't unarchive that post")).toBeInTheDocument();

    // The write failed, so the row is back — and navigable again. A row that left on a failed
    // write must not stay out of the keyboard's reach for the rest of the session.
    await user.keyboard('k');

    expect(rowFor('The one above')).toHaveAttribute('data-selected', 'true');
  });

  it('binds e to Unarchive on the selected row', async () => {
    const user = userEvent.setup();
    mockApi.fetchReaderPosts.mockResolvedValue([POST]);
    mockApi.patchReaderPost.mockResolvedValue({ ...POST, archived_at: null });
    renderReader(<ArchiveView now={NOW} />);
    await screen.findByRole('button', { name: 'Unarchive' });

    await user.keyboard('j');
    await user.keyboard('e');
    endExit();

    await waitFor(() => {
      expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { archived: false });
    });
  });
});
