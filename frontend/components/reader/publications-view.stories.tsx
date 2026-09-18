import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { makeReaderCandidate, makeReaderPublicationListItem } from '@/lib/reader/fixtures';
import { ReaderSettingsProvider } from '@/lib/stores/reader-settings-store';
import { ToastProvider } from '@/lib/stores/toast-store';

import { PublicationsView } from './publications-view';

/**
 * The publications roster: an enabled and a paused card plus the candidates section, and both
 * of the surface's empty states.
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
