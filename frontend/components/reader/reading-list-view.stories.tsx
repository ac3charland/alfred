import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { readerFixtureSet } from '@/lib/reader/fixtures';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderPost, ReaderPostListItem } from '@/lib/types';

import { ReadingListView } from './reading-list-view';

/**
 * The reading list itself: populated with every Story-1 row state at once (the fixture set), and
 * the resting empty state.
 */

/** The instant every row's date is read against, as `post-row.stories.tsx` pins its own. */
const NOW = new Date(2026, 8, 18, 9, 0);

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest pinned arrival — every later fixture lands `index` days after it. */
const BASE_RECEIVED_AT = new Date(Date.UTC(2026, 8, 12, 14, 0, 0));

function withoutText({ text: _text, ...listItem }: ReaderPost) {
  return listItem;
}

/**
 * The fixture set as the list read hands it over — no `text`, and an arrival that never moves.
 * The set anchors `received_at` to the wall clock, so a snapshot of it would otherwise carry the
 * date it was taken on. One day apart, in the same relative order the wall-clock fixtures already
 * arrived in — the view itself renders newest first; pinning only swaps each post's real arrival
 * instant for a deterministic one at that same relative position, via `Date` math rather than a
 * calendar-day string so a longer fixture set can't roll past the end of the month.
 */
function pinnedPosts(): ReaderPostListItem[] {
  const { posts } = readerFixtureSet();
  return posts.map((post, index) => ({
    ...withoutText(post),
    received_at: new Date(BASE_RECEIVED_AT.getTime() + index * DAY_MS).toISOString(),
  }));
}

const withFrame: Decorator = (Story) => (
  <div data-testid="list-frame" className="w-[720px] bg-background p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Reader/ReadingListView',
  component: ReadingListView,
  decorators: [withFrame],
  args: { now: NOW },
} satisfies Meta<typeof ReadingListView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every Story-1 row state at once — the demo doc's populated screenshot. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderProvider initialPosts={pinnedPosts()}>
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
};

/** Nothing to read — the resting empty state. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderProvider initialPosts={[]}>
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
};
