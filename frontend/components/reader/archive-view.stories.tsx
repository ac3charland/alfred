import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { userEvent, within } from 'storybook/test';

import { NO_READER_HEALTH, makeReaderOverview, makeReaderPost } from '@/lib/reader/fixtures';
import { ARCHIVE_READ_LIMIT, ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { ArchiveView } from './archive-view';

/**
 * The archive: a populated list with a selected row, the same list read back at its ceiling
 * (which is the only time the slice line appears), the empty state the view rests at once its
 * read has landed with nothing in it, and the read that never answered.
 *
 * The view reads its own scope on mount, so every story answers that read itself rather than
 * seeding the provider — the empty state and the slice line are both consequences of what
 * came back, and a seeded list could show neither honestly.
 */

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, {
    archived_at: '2026-09-17T09:00:00.000Z',
    ...overrides,
  });
  return listItem;
}

/** Two finished posts put away, drawn from the mockup's archive. */
const ARCHIVED: ReaderPostListItem[] = [
  post({
    id: 'p-forecasting',
    author: 'Second Thoughts',
    title: 'Why every forecasting tournament converges on the same three people',
    received_at: '2026-09-12T14:00:00.000Z',
    word_count: 2400,
    html_extracted: true,
    canonical_url: 'https://secondthoughts.substack.com/p/forecasting-tournaments',
    summary_state: 'done',
    gist:
      'A selection-effects argument: the tournaments reward calibration on questions with short ' +
      'resolution windows, and the same three forecasters specialise in exactly those.',
    overview: makeReaderOverview({
      novel_ideas: [
        'Resolution-window length, not question domain, predicts who wins a tournament.',
      ],
    }),
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-12T14:05:00.000Z',
  }),
  post({
    id: 'p-import-ai-411',
    author: 'Import AI',
    title: 'Import AI 411',
    received_at: '2026-09-09T14:00:00.000Z',
    word_count: 1720,
    html_extracted: true,
    canonical_url: 'https://importai.substack.com/p/import-ai-411',
    summary_state: 'done',
    gist: 'Roundup; nothing new this week beyond the two eval releases already covered.',
    overview: makeReaderOverview(),
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-09T14:05:00.000Z',
  }),
];

/** The archive at its ceiling: the same two posts, padded out to the limit the read asks for. */
const ARCHIVED_FULL: ReaderPostListItem[] = [
  ...ARCHIVED,
  ...Array.from({ length: ARCHIVE_READ_LIMIT - ARCHIVED.length }, (_, index) =>
    post({
      id: `p-older-${String(index)}`,
      author: 'Second Thoughts',
      title: `An older post, put away long ago (${String(index + 1)})`,
      received_at: new Date(Date.UTC(2026, 7, 1) - index * 86_400_000).toISOString(),
      word_count: 1200,
      summary_state: 'done',
      gist: 'One of the many posts already skimmed and filed.',
    }),
  ),
];

/**
 * Stub the archive read with `answer` and hand the view an empty store to fold it into. Every
 * story's state is a consequence of what came back, so the read is stubbed rather than the store
 * pre-seeded.
 */
function withArchiveReadOf(answer: () => Promise<unknown>): Decorator {
  return function ArchiveRead(Story) {
    globalThis.fetch = answer as unknown as typeof fetch;
    return (
      <ToastProvider>
        <ReaderProvider initialPosts={[]} initialHealth={NO_READER_HEALTH}>
          <Story />
        </ReaderProvider>
      </ToastProvider>
    );
  };
}

/** Answer the archive read with `rows`, the way the route would. */
function withArchiveRead(rows: ReaderPostListItem[]): Decorator {
  return withArchiveReadOf(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(rows),
      text: () => Promise.resolve(JSON.stringify(rows)),
    }),
  );
}

/** The read never answers at all — an offline tab, which the view has to speak for itself. */
const withFailedArchiveRead: Decorator = withArchiveReadOf(() =>
  Promise.reject(new Error('offline')),
);

const withFrame: Decorator = (Story) => (
  <div data-testid="archive-frame" className="w-[720px] bg-background p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Reader/ArchiveView',
  component: ArchiveView,
  decorators: [withFrame],
  args: { now: NOW },
} satisfies Meta<typeof ArchiveView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The archive as it is browsed, with the top row selected and its key hints beside Unarchive.
 *
 * Selected by clicking the card twice — the card selects and toggles the overview together, so the
 * second click leaves the row selected and closed.
 */
export const Populated: Story = {
  decorators: [withArchiveRead(ARCHIVED)],
  parameters: { visualTest: { target: '[data-testid="archive-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByText(
      'Why every forecasting tournament converges on the same three people',
    );
    await userEvent.click(card);
    await userEvent.click(card);
  },
};

/**
 * The read came back at its ceiling, so the view says what it is showing.
 *
 * Documented but not captured: two hundred rows make a crop tall enough that the one line under
 * test is a rounding error against the 1% threshold, so the snapshot could never fail on it.
 * `archive-view.test.tsx` pins the line instead.
 */
export const LatestTwoHundred: Story = {
  decorators: [withArchiveRead(ARCHIVED_FULL)],
};

/** Nothing has ever been archived — the view's resting state, once the read has landed. */
export const Empty: Story = {
  decorators: [withArchiveRead([])],
  parameters: { visualTest: { target: '[data-testid="archive-frame"]' } },
};

/**
 * The read never answered. A blank archive would read as "nothing here", so the view says what
 * happened and offers the read again — the one state where the owner has something to press.
 */
export const ReadFailed: Story = {
  decorators: [withFailedArchiveRead],
  parameters: { visualTest: { target: '[data-testid="archive-frame"]' } },
};
