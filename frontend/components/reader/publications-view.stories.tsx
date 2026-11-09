import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import {
  makeReaderCandidate,
  makeReaderFeed,
  makeReaderPublicationListItem,
} from '@/lib/reader/fixtures';
import { ReaderSettingsProvider } from '@/lib/stores/reader-settings-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderPublicationListItem } from '@/lib/types';

import { PublicationsView } from './publications-view';

/**
 * The publications roster: an enabled and a paused card plus the candidates section, both of the
 * surface's empty states, a card of each summary kind, and the two pickers a kind is chosen with —
 * the card's chip and a candidate's "Add as". The `Feed…` stories are the three states a feed
 * adds: a feed on the roster, a homepage refused at the Add field, and a feed that stopped
 * answering.
 */

/** The instant every card's date is read against, as `reading-list-view.stories.tsx` pins its own. */
const NOW = new Date(2026, 8, 18, 9, 0);

const PUBLICATIONS = [
  makeReaderPublicationListItem('Second Thoughts', {
    handle: 'secondthoughts@substack.com',
    source: 'auto',
    last_post_at: '2026-09-16T12:00:00.000Z',
  }),
  makeReaderPublicationListItem('Stratechery', {
    handle: 'email@stratechery.com',
    source: 'owner',
    notes: 'Daily update is paywalled; the email carries the whole post.',
    last_post_at: '2026-09-15T12:00:00.000Z',
  }),
  makeReaderPublicationListItem('Some Substack I stopped reading', {
    handle: 'quietletter@substack.com',
    source: 'auto',
    enabled: false,
    last_post_at: '2026-08-02T12:00:00.000Z',
  }),
];

const CANDIDATES = [
  makeReaderCandidate('hello@bensbites.beehiiv.com', {
    name: "Ben's Bites",
    message_count: 9,
    last_seen_at: '2026-09-17T12:00:00.000Z',
  }),
  makeReaderCandidate('store-news@amazon.com', {
    name: 'Amazon.com',
    message_count: 22,
    last_seen_at: '2026-09-18T12:00:00.000Z',
  }),
];

const withFrame: Decorator = (Story) => (
  <div data-testid="publications-frame" className="w-[720px] bg-background p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Reader/PublicationsView',
  component: PublicationsView,
  decorators: [withFrame],
  args: { now: NOW },
} satisfies Meta<typeof PublicationsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A populated roster (one paused) alongside two candidates — the demo doc's screenshot. */
export const Populated: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderSettingsProvider initialPublications={PUBLICATIONS} initialCandidates={CANDIDATES}>
          <Story />
        </ReaderSettingsProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
};

/** No publications yet — candidates still render. */
export const EmptyRoster: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderSettingsProvider initialPublications={[]} initialCandidates={CANDIDATES}>
          <Story />
        </ReaderSettingsProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
};

/** A roster with nothing left to promote. */
export const EmptyCandidates: Story = {
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReaderSettingsProvider initialPublications={PUBLICATIONS} initialCandidates={[]}>
          <Story />
        </ReaderSettingsProvider>
      </ToastProvider>
    ),
  ],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
};

/** One card of each summary kind: the muted chip names it, Essay by default. */
const KINDED = [
  makeReaderPublicationListItem('Import AI', {
    handle: 'importai@substack.com',
    source: 'auto',
    summary_kind: 'roundup',
    last_post_at: '2026-09-17T12:00:00.000Z',
  }),
  makeReaderPublicationListItem('Patagonia', {
    handle: 'news@patagonia.com',
    source: 'owner',
    summary_kind: 'alerts',
    last_post_at: '2026-09-18T08:00:00.000Z',
  }),
  makeReaderPublicationListItem('Second Thoughts', {
    handle: 'secondthoughts@substack.com',
    source: 'auto',
    last_post_at: '2026-09-16T12:00:00.000Z',
  }),
];

const withKinded: Decorator = (Story) => (
  <ToastProvider>
    <ReaderSettingsProvider initialPublications={KINDED} initialCandidates={CANDIDATES.slice(1)}>
      <Story />
    </ReaderSettingsProvider>
  </ToastProvider>
);

/** A card of each kind — Roundup, Alerts, and an Essay by default. */
export const EachKind: Story = {
  decorators: [withKinded],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
};

/** A card's kind chip open: each kind with the question it asks, the current one ticked. */
export const KindPickerOpen: Story = {
  decorators: [withKinded],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Summary type for Import AI: Roundup' }),
    );
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Highlights, and the links worth reading')).toBeVisible();
  },
};

/** A candidate's "Add as" open: a sender is never put on the roster without a kind. */
export const AddAsOpen: Story = {
  decorators: [withKinded],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Add Amazon.com as…' }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('menuitem', { name: /^Alerts/ })).toBeVisible();
  },
};

// ── Feeds ────────────────────────────────────────────────────────────────────

/** A healthy feed beside a sender: the feed chip, its URL, its newest post and its last check. */
const FEED = {
  ...makeReaderFeed('mlarson.org', 'https://mlarson.org/feed.xml', {
    feed_checked_at: '2026-09-18T07:48:00.000Z',
    feed_last_success_at: '2026-09-18T07:48:00.000Z',
  }),
  last_post_at: '2026-09-14T12:00:00.000Z',
};

/** A feed whose blog answered 404 on its last three hourly polls. */
const FAILING_FEED = {
  ...makeReaderFeed('mlarson.org', 'https://mlarson.org/feed.xml', {
    feed_checked_at: '2026-09-18T07:48:00.000Z',
    feed_last_success_at: '2026-09-18T05:48:00.000Z',
    feed_last_error: 'it answered 404',
    feed_last_error_at: '2026-09-18T07:48:00.000Z',
  }),
  last_post_at: '2026-09-14T12:00:00.000Z',
};

const SENDER = makeReaderPublicationListItem('Import AI', {
  handle: 'importai@substack.com',
  source: 'auto',
  summary_kind: 'roundup',
  last_post_at: '2026-09-17T12:00:00.000Z',
});

function withRoster(publications: ReaderPublicationListItem[]): Decorator {
  function RosterDecorator(Story: React.ComponentType) {
    return (
      <ToastProvider>
        <ReaderSettingsProvider initialPublications={publications} initialCandidates={[]}>
          <Story />
        </ReaderSettingsProvider>
      </ToastProvider>
    );
  }
  return RosterDecorator;
}

/** A feed on the roster: a card like a sender's, with a `feed` chip and its URL and last check. */
export const FeedAdded: Story = {
  decorators: [withRoster([FEED, SENDER])],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
};

/**
 * A homepage pasted into the field: the route refuses it as not a feed, and the field keeps the
 * text with the reason on one line beneath it.
 */
export const NotAFeed: Story = {
  decorators: [withRoster([SENDER])],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ error: 'not-a-feed' }, { status: 422 }));
    return () => {
      globalThis.fetch = original;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Feed URL' }), 'https://mlarson.org');
    await userEvent.click(canvas.getByRole('button', { name: 'Add feed' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      "That page isn't an RSS or Atom feed.",
    );
  },
};

/** A feed that stopped answering: its card says what failed and since when, in amber. */
export const FeedFailing: Story = {
  decorators: [withRoster([FAILING_FEED, SENDER])],
  parameters: { visualTest: { target: '[data-testid="publications-frame"]' } },
};
