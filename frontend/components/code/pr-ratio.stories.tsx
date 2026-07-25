import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import type { PrRatioResponse } from '@/lib/types';

import { PrRatio } from './pr-ratio';

const WEEK = {
  start: '2026-07-20T00:00:00-04:00',
  end: '2026-07-27T00:00:00-04:00',
  timezone: 'America/New_York',
};

const SPLIT: PrRatioResponse = {
  week: WEEK,
  total: 9,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
  ],
};

const EMPTY_WEEK: PrRatioResponse = {
  week: WEEK,
  total: 0,
  repos: SPLIT.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
};

/**
 * The card fetches on mount, so each story pins what the endpoint answers by stubbing
 * `fetch` for the duration of the story — no network, no clock, a deterministic snapshot.
 * `undefined` body means "never settles", which parks the card in its loading state.
 */
function stubEndpoint(status: number, body?: unknown) {
  return (Story: React.ComponentType) => {
    globalThis.fetch = (() =>
      body === undefined
        ? new Promise(() => {})
        : Promise.resolve({
            ok: status < 400,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(JSON.stringify(body)),
          })) as unknown as typeof fetch;
    return <Story />;
  };
}

const meta = {
  title: 'Code/PrRatio',
  component: PrRatio,
  parameters: {
    visualTest: { target: '[data-testid="pr-ratio-frame"]' },
  },
  decorators: [
    (Story) => (
      <div data-testid="pr-ratio-frame" className="w-[760px] bg-background p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PrRatio>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The resting state: a stacked bar whose segments are sized by each repo's share, plus a
 * legend giving every repo its percentage and its raw count. The percentages sum to exactly
 * 100 — largest-remainder rounding, so the classic "33% / 66%" bar can't happen.
 */
export const Ready: Story = {
  decorators: [stubEndpoint(200, SPLIT)],
};

/**
 * A week that genuinely hasn't seen a merge yet — every Monday starts here. A muted line
 * rather than an empty bar, because a zero-width bar reads as broken, not as zero.
 */
export const ZeroTotal: Story = {
  decorators: [stubEndpoint(200, EMPTY_WEEK)],
};

/** In flight: the card reserves the bar's height so the Backlog list beneath doesn't jump. */
export const Loading: Story = {
  decorators: [stubEndpoint(200)],
};

/**
 * GitHub unreachable or rate-limited (502). One muted line — no toast, no retry loop — and
 * the Backlog around it stays fully usable.
 */
export const Failed: Story = {
  decorators: [stubEndpoint(502, { error: 'GitHub request failed' })],
};
