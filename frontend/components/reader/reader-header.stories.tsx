import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { makeCommAccount } from '@/lib/comms/fixtures';
import {
  NO_READER_HEALTH,
  READER_HEALTH_FIXTURE_NOW,
  makeReaderHealth,
  makeReaderPost,
} from '@/lib/reader/fixtures';
import type { ReaderPostListItem } from '@/lib/types';

import { ReaderHeader } from './reader-header';

/**
 * One story per state the health block can be in — healthy, mailbox dead, summariser stalled,
 * daily ceiling spent, summariser never run. Everything here is read against `now`, so the
 * instant is pinned: an unpinned header would bake the capture day into its own baseline.
 */

const NOW = new Date(READER_HEALTH_FIXTURE_NOW);
const MINUTE_MS = 60 * 1000;
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const LIVE_ACCOUNT = makeCommAccount('Personal', {
  id: '00000000-0000-4000-8000-0000000000aa',
  key: 'gmail-personal',
  last_seen_at: ago(1),
});

/** A claimed post the tick has not summarised yet — what the stall and ceiling states read. */
function waiting(minutes: number): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, {
    id: `p-waiting-${String(minutes)}`,
    summary_state: 'pending',
    word_count: 1200,
    created_at: ago(minutes),
    received_at: ago(minutes),
  });
  return listItem;
}

const withFrame: Decorator = (Story) => (
  <div data-testid="header-frame" className="w-[720px] bg-background p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Reader/ReaderHeader',
  component: ReaderHeader,
  decorators: [withFrame],
  args: { now: NOW, posts: [], description: '6 to read' },
  parameters: { visualTest: { target: '[data-testid="header-frame"]' } },
} satisfies Meta<typeof ReaderHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Everything working: two green dots, no sentence, no banner. */
export const Healthy: Story = {
  args: {
    snapshot: {
      health: makeReaderHealth('live', {}, NOW),
      account: LIVE_ACCOUNT,
    },
  },
};

/** The mailbox is refusing the poll — the dot goes red and the sentence says what to do. */
export const GmailDead: Story = {
  args: {
    snapshot: {
      health: makeReaderHealth('live', {}, NOW),
      account: {
        ...LIVE_ACCOUNT,
        last_seen_at: ago(360),
        last_error_at: ago(120),
        last_error: 'invalid_grant',
      },
    },
  },
};

/** The tick recorded a failure more recently than a success: posts arrive, none are summarised. */
export const SummariserStalled: Story = {
  args: {
    posts: [waiting(90)],
    snapshot: {
      health: makeReaderHealth(
        'stalled',
        { last_error_at: ago(48), last_error: 'ANTHROPIC_API_KEY is not set' },
        NOW,
      ),
      account: LIVE_ACCOUNT,
    },
  },
};

/**
 * Today's model budget is spent. The dots stay green — nothing is broken, the waiting is by
 * design — and the banner above the header is what says so.
 */
export const CeilingReached: Story = {
  args: {
    posts: [waiting(90), waiting(120), waiting(150), waiting(180)],
    snapshot: { health: makeReaderHealth('ceiling', {}, NOW), account: LIVE_ACCOUNT },
  },
};

/** No health row at all — the cron has never fired, which is not the same as a stall. */
export const NeverRan: Story = {
  args: {
    posts: [waiting(90)],
    snapshot: { ...NO_READER_HEALTH, account: LIVE_ACCOUNT },
  },
};
