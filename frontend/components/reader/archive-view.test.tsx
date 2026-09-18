import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderOverview, makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import { ARCHIVE_READ_LIMIT } from '@/lib/stores/reader-store';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { ArchiveView } from './archive-view';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

const NOW = new Date(2026, 8, 18, 9, 0);
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

/** jsdom plays no CSS transitions, so fire the exit wrapper's own transitionend by hand. */
function endExit(): void {
  const wrapper = screen.getByTestId('reader-row-collapse');
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
  fireEvent(wrapper, event);
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

    expect(await screen.findByText('Showing the latest 200')).toBeInTheDocument();
  });

  it('says nothing about a slice when the archive fits', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([archived({ id: 'p-1', title: 'The only one' })]);
    renderReader(<ArchiveView now={NOW} />);

    expect(await screen.findByText('The only one')).toBeInTheDocument();
    expect(screen.queryByText('Showing the latest 200')).not.toBeInTheDocument();
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
