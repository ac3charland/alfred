import type { Meta, StoryObj } from '@storybook/nextjs';

import { makeCommAccount, makeCommHealth } from '@/lib/comms/fixtures';

import { CommsHeader } from './comms-header';

/**
 * The health surface on its own — the dots and the sentence each unhealthy source gets.
 *
 * It is snapshotted here as well as inside `CommsQueueView` because the two crops gate
 * different things: a whole-view baseline is thousands of pixels tall, and the mismatch
 * threshold that keeps it from flapping is wider than the 8px dot whose COLOUR is the entire
 * claim. Cropped to the masthead, a green dot turning amber is the whole diff.
 *
 * Every instant is built against a PINNED `now`, and the header is given that same `now`, so
 * the states and the "3h ago" strings are identical in every timezone and on every day the
 * suite runs.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const ago = (millis: number): string => new Date(NOW.getTime() - millis).toISOString();

/** Polled inside its interval: nothing is wrong and nothing is said. */
const live = (label: string, overrides = {}) =>
  makeCommAccount(label, { id: `acct-${label}`, last_seen_at: ago(3 * MINUTE), ...overrides });

/** Nothing has arrived for longer than the interval — and alfred cannot say why. */
const silent = (label: string, overrides = {}) =>
  makeCommAccount(label, { id: `acct-${label}`, last_seen_at: ago(3 * HOUR), ...overrides });

const DAEMON = { home: 'daemon', kind: 'imessage', expected_interval_seconds: 900 } as const;

const HEALTHY_CLASSIFIER = makeCommHealth({
  last_run_at: ago(MINUTE),
  last_success_at: ago(MINUTE),
});

const meta = {
  title: 'Comms/CommsHeader',
  component: CommsHeader,
  args: { now: NOW, messages: [], health: HEALTHY_CLASSIFIER },
  parameters: { visualTest: { target: '[data-testid="comms-header-frame"]' } },
  decorators: [
    (Story) => (
      <div data-testid="comms-header-frame" className="w-[760px] bg-background p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommsHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every source polling on time: three green dots and not one sentence. This is the state a tab
 * that has been open for hours must still be able to show — the module's zero only means
 * something while the dots are honest (ALF-227).
 */
export const EverySourceLive: Story = {
  args: {
    accounts: [live('personal'), live('RealPlay'), live('iMessage', DAEMON)],
  },
};

/**
 * Nothing has arrived from any source for hours. The dots go amber and each account says what
 * its silence means — and the two homes say different things, because one waits and one acts:
 * the Mac's sources come back on their own, a Worker-polled mailbox needs a person.
 */
export const EverySourceStale: Story = {
  args: {
    accounts: [silent('personal'), silent('RealPlay'), silent('iMessage', DAEMON)],
  },
};

/**
 * One source erroring beside two that are fine — polls reaching the mailbox and being refused,
 * which is a different colour and a different fix from silence. Drawn together because the
 * whole point of the surface is that the three states are told apart at a glance.
 */
export const OneSourceErroring: Story = {
  args: {
    accounts: [
      live('personal'),
      makeCommAccount('RealPlay', {
        id: 'acct-RealPlay',
        last_seen_at: ago(4 * HOUR),
        last_error: 'the refresh token was rejected',
        last_error_at: ago(40 * MINUTE),
      }),
      live('iMessage', DAEMON),
    ],
  },
};
