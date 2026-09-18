import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { makeCommAccount } from '@/lib/comms/fixtures';
import { READER_HEALTH_FIXTURE_NOW } from '@/lib/reader/fixtures';

import { ReaderBanner } from './reader-banner';

/**
 * The four things that can be wrong with the Reader, each drawn on its own. Only one ever
 * renders in the app — which one is `readerBanner`'s call — so each state gets a story here
 * rather than a stacked sample.
 */

/** The instant every elapsed reading is measured from, pinned so the copy never drifts. */
const NOW = new Date(READER_HEALTH_FIXTURE_NOW);

const MINUTE_MS = 60 * 1000;

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const ACCOUNT = makeCommAccount('Personal', {
  id: '00000000-0000-4000-8000-0000000000aa',
  key: 'gmail-personal',
  last_seen_at: ago(360),
});

const withFrame: Decorator = (Story) => (
  <div data-testid="banner-frame" className="w-[720px] bg-background p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Reader/ReaderBanner',
  component: ReaderBanner,
  decorators: [withFrame],
  args: { now: NOW },
  parameters: { visualTest: { target: '[data-testid="banner-frame"]' } },
} satisfies Meta<typeof ReaderBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The mailbox is refusing the poll — red, because it is the one state that needs a person. */
export const GmailDead: Story = {
  args: {
    banner: {
      kind: 'gmail',
      state: 'erroring',
      account: { ...ACCOUNT, last_error_at: ago(120), last_error: 'invalid_grant' },
    },
  },
};

/** The same mailbox merely gone quiet — amber, because nothing was refused and nothing is lost. */
export const GmailQuiet: Story = {
  args: { banner: { kind: 'gmail', state: 'stale', account: ACCOUNT } },
};

/** Posts arrive and sit: the tick recorded a systemic failure and nothing is being summarised. */
export const SummariserStalled: Story = {
  args: {
    banner: { kind: 'stalled', since: ago(48), error: 'ANTHROPIC_API_KEY is not set' },
  },
};

/** Today's model budget is spent — informational, and the count is the whole point of it. */
export const CeilingReached: Story = {
  args: { banner: { kind: 'ceiling', cap: 30, waiting: 4 } },
};
