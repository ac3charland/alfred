import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderPost, readerFixtureSet, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import type { ReaderPost, ReaderPostListItem } from '@/lib/types';

import { ReadingListView } from './reading-list-view';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

/** The list read's own shape (B13) — every fixture post has to drop `text` before rendering. */
function withoutText(post: ReaderPost): ReaderPostListItem {
  const { text: _text, ...listItem } = post;
  return listItem;
}

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
