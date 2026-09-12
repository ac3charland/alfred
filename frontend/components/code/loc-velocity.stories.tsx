import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import type { LocVelocityResponse, LocWeek } from '@/lib/types';

import { LocVelocity } from './loc-velocity';

/** Twelve weeks ending Sunday 6 Sep 2026, read mid-week — so the last bucket is partial. */
const LINES = [3120, 3380, 3300, 4620, 4400, 4560, 5480, 5160, 5740, 6140, 5900, 1980];

const FIRST_SUNDAY = Date.parse('2026-06-21T00:00:00Z');
const MS_PER_WEEK = 604_800_000;

/** The series the endpoint would return for `values`: trailing means, last week in progress. */
function weeks(values: number[]): LocWeek[] {
  return values.map((value, index) => {
    const partial = index === values.length - 1;
    const window = values.slice(Math.max(0, index - 3), index + 1);
    return {
      week: new Date(FIRST_SUNDAY + index * MS_PER_WEEK).toISOString().slice(0, 10),
      lines: value,
      average: partial
        ? null
        : Math.round(window.reduce((sum, entry) => sum + entry, 0) / window.length),
      partial,
    };
  });
}

function velocity(values: number[]): LocVelocityResponse {
  return {
    weeks: weeks(values),
    repos: ['ac3charland/realplay', 'ac3charland/alfred'],
    authors: ['ac3charland'],
    averageWeeks: 4,
  };
}

/**
 * The card fetches on mount, so each story pins what the endpoint answers by stubbing `fetch`
 * for the duration of the story — no network, no clock, a deterministic snapshot. `undefined`
 * body means "never settles", which parks the card in its loading state.
 */
function stubEndpoint(status: number, body?: unknown) {
  return (Story: React.ComponentType) => {
    globalThis.fetch = (() =>
      body === undefined && status === 200
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
  title: 'Code/LocVelocity',
  component: LocVelocity,
  parameters: { visualTest: { target: '[data-testid="loc-velocity-frame"]' } },
  decorators: [
    (Story) => (
      <div data-testid="loc-velocity-frame" className="w-[760px] bg-background p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LocVelocity>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The resting state: one bar per week under the four-week trailing-average line, the axis
 * maximum on a dashed top rule, and a legend naming exactly the three marks drawn. The week
 * still in progress is dimmed, and the line stops at the last COMPLETE week rather than being
 * dragged down by a mid-week reading.
 */
export const Ready: Story = {
  decorators: [stubEndpoint(200, velocity(LINES))],
};

/**
 * The same window read on a Sunday night, one day into the new week: the partial bar is barely
 * there, which is honest — it is one day of work, not a collapse in output.
 */
export const EarlyInTheWeek: Story = {
  decorators: [stubEndpoint(200, velocity([...LINES.slice(0, 11), 180]))],
};

/** Twelve genuinely quiet weeks. A muted line rather than a flat plot, which reads as broken. */
export const AllZero: Story = {
  decorators: [stubEndpoint(200, velocity(Array.from({ length: 12 }, () => 0)))],
};

/**
 * A six-digit week (a big vendor bump or a large refactor): the axis rounds to the nearest
 * 20,000 rather than the next 100,000, so a 102,000-line week caps the plot at 120,000 instead
 * of blowing it out to 200,000 (ALF-230).
 */
export const HighVolumeWeek: Story = {
  decorators: [
    stubEndpoint(
      200,
      velocity([
        42_000, 51_000, 38_000, 67_000, 58_000, 74_000, 91_000, 102_000, 88_000, 65_000, 47_000,
        12_000,
      ]),
    ),
  ],
};

/** In flight: the card reserves the plot's height so the cards beneath it don't jump. */
export const Loading: Story = {
  decorators: [stubEndpoint(200)],
};

/**
 * GitHub computes contributor statistics asynchronously, and a cold cache answers 202 with no
 * body. That is its own outcome: an error note would be wrong about something that works in a
 * minute, and a chart of zeros would be a lie.
 */
export const Computing: Story = {
  decorators: [stubEndpoint(202, { error: 'GitHub is still computing these statistics' })],
};

/**
 * GitHub unreachable or rate-limited (502). One muted line — no toast, no retry loop — and the
 * Dashboard around it stays fully usable.
 */
export const Failed: Story = {
  decorators: [stubEndpoint(502, { error: 'GitHub request failed' })],
};
