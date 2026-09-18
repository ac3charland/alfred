import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import type { ReaderPostListItem } from '@/lib/types';

import { PostList } from './post-list';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(title: string, id: string, receivedAt: string): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, {
    id,
    title,
    received_at: receivedAt,
  });
  return listItem;
}

const POSTS = [
  post('Alpha', 'p-a', '2026-09-16T09:00:00.000Z'),
  post('Beta', 'p-b', '2026-09-15T09:00:00.000Z'),
];

/** Which row the keyboard is pointing at, by title. */
function selectedTitle(): string | undefined {
  const row = screen
    .getAllByTestId('reader-row')
    .find((element) => element.dataset['selected'] === 'true');
  return row?.querySelector('p')?.textContent ?? undefined;
}

/** The drawn row whose title says `title`, so nothing has to be indexed by position. */
function rowFor(title: string): HTMLElement {
  const found = screen
    .getAllByTestId('reader-row')
    .find((row) => row.querySelector('p')?.textContent === title);
  if (found === undefined) throw new Error(`No row titled ${title} is on screen`);
  return found;
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('PostList', () => {
  it('draws the posts in the order it is handed them, none selected', () => {
    renderReader(<PostList posts={POSTS} now={NOW} />, POSTS);

    const titles = screen
      .getAllByTestId('reader-row')
      .map((row) => row.querySelector('p')?.textContent);
    expect(titles).toEqual(['Alpha', 'Beta']);
    expect(selectedTitle()).toBeUndefined();
  });

  it('gives the archive variant the reversed verb', () => {
    renderReader(<PostList posts={POSTS} now={NOW} variant="archive" />, POSTS);

    expect(screen.getAllByRole('button', { name: 'Unarchive' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('follows a row archived with the mouse: the click selects it, its exit moves on', async () => {
    const user = userEvent.setup();
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    renderReader(<PostList posts={POSTS} now={NOW} />, POSTS);

    // Every verb points the keyboard at the row it acts on, so a mouse archive leaves the
    // selection where the list moved to — on the row taking the archived one's place, not on
    // whichever row the keyboard happened to be left on.
    await user.click(within(rowFor('Alpha')).getByRole('button', { name: 'Archive' }));

    expect(selectedTitle()).toBe('Beta');
  });

  it('never walks back onto a row that is on its way out', async () => {
    const user = userEvent.setup();
    // The write is held in flight, so the archived row stays drawn through its collapse — the
    // window in which `k` could otherwise point the keyboard at a row that is leaving.
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    renderReader(<PostList posts={POSTS} now={NOW} />, POSTS);

    await user.keyboard('j');
    await user.keyboard('e');
    expect(selectedTitle()).toBe('Beta');

    await user.keyboard('k');

    expect(selectedTitle()).toBe('Beta');
  });

  it('holds the selection on the last row rather than wrapping round', async () => {
    const user = userEvent.setup();
    renderReader(<PostList posts={POSTS} now={NOW} />, POSTS);

    await user.keyboard('jjj');

    expect(selectedTitle()).toBe('Beta');
  });

  it('does nothing on a navigation key when there is nothing to navigate', async () => {
    const user = userEvent.setup();
    renderReader(<PostList posts={[]} now={NOW} />, []);

    await user.keyboard('j');

    expect(screen.queryAllByTestId('reader-row')).toHaveLength(0);
  });
});
