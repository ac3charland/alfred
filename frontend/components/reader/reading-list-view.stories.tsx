import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { userEvent, within } from 'storybook/test';

import { makeCommAccount } from '@/lib/comms/fixtures';
import { makeReaderHealth, readerFixtureSet } from '@/lib/reader/fixtures';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderHealthSnapshot, ReaderPost, ReaderPostListItem } from '@/lib/types';

import { ReadingListView } from './reading-list-view';

/**
 * The reading list itself: populated with every row state at once (the fixture set), the same
 * list driven from the keyboard, and the resting empty state.
 */

/** The instant every row's date is read against, as `post-row.stories.tsx` pins its own. */
const NOW = new Date(2026, 8, 18, 9, 0);

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest pinned arrival — every later fixture lands `index` days after it. */
const BASE_RECEIVED_AT = new Date(Date.UTC(2026, 8, 12, 14, 0, 0));

function withoutText({ text: _text, html: _html, ...listItem }: ReaderPost) {
  return listItem;
}

/** The last summary to land — recent enough that the summariser reads as working. */
const LAST_SUMMARY_AT = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();

/**
 * The fixture set as the list read hands it over — no `text`, and an arrival that never moves.
 * The set anchors `received_at` to the wall clock, so a snapshot of it would otherwise carry the
 * date it was taken on. One day apart, in the same relative order the wall-clock fixtures already
 * arrived in — the view itself renders newest first; pinning only swaps each post's real arrival
 * instant for a deterministic one at that same relative position, via `Date` math rather than a
 * calendar-day string so a longer fixture set can't roll past the end of the month.
 *
 * `created_at` (the instant the tick claimed a post) and `summarized_at` are pinned for the same
 * reason and with more at stake: the health block reads both against `now`, so leaving them on
 * the wall clock would let the same story draw a live summariser one hour and a stalled one the
 * next, with the drift hiding under the snapshot threshold.
 */
function pinnedPosts(): ReaderPostListItem[] {
  const { posts } = readerFixtureSet();
  return posts.map((post, index) => {
    const receivedAt = new Date(BASE_RECEIVED_AT.getTime() + index * DAY_MS).toISOString();
    return {
      ...withoutText(post),
      received_at: receivedAt,
      created_at: receivedAt,
      summarized_at: post.summarized_at === null ? null : LAST_SUMMARY_AT,
    };
  });
}

/** Everything working: the tick ran a moment ago, and the mailbox polled a moment ago. */
function healthySnapshot(): ReaderHealthSnapshot {
  return {
    health: makeReaderHealth('live', {}, NOW),
    account: makeCommAccount('Personal', {
      id: '00000000-0000-4000-8000-0000000000aa',
      key: 'gmail-personal',
      last_seen_at: new Date(NOW.getTime() - 60 * 1000).toISOString(),
    }),
  };
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
        <ReaderProvider
          initialPosts={pinnedPosts()}
          initialHealth={healthySnapshot()}
          instapaperConfigured
        >
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
};

/**
 * A row the keyboard is pointing at, collapsed: the selection ring, and a key hint beside each of
 * the three verbs it can run. Selection and the overview are separate states, so this row carries
 * the ring without the panel.
 *
 * Selected by clicking the card twice — the card selects and toggles the overview together, so the
 * second click leaves the row selected and closed. The keys are pinned by the view's own tests and
 * by the Playwright journey.
 */
export const SelectedCollapsed: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderProvider
          initialPosts={pinnedPosts()}
          initialHealth={healthySnapshot()}
          instapaperConfigured
        >
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByText('Import AI 412: three new evals, and a robot that folds');
    await userEvent.click(card);
    await userEvent.click(card);
  },
};

/** The same selected row with its overview open — the ring and the expansion wash at once. */
export const SelectedExpanded: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderProvider
          initialPosts={pinnedPosts()}
          initialHealth={healthySnapshot()}
          instapaperConfigured
        >
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByText('Import AI 412: three new evals, and a robot that folds'),
    );
  },
};

/** Nothing to read — the resting empty state. */
export const Empty: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderProvider initialPosts={[]} initialHealth={healthySnapshot()} instapaperConfigured>
          <Story />
        </ReaderProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="list-frame"]' } },
};
