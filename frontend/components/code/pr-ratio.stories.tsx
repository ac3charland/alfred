import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { PrRatioResponse, Project } from '@/lib/types';

import { PrRatio } from './pr-ratio';

/**
 * The projects the card joins each repo to, oldest first — so RealPlay wears the module's first
 * colour (blue) and Alfred its second (amber), exactly as they do in ProjectNav.
 */
const PROJECTS: Project[] = [
  {
    color: null,
    description: null,
    exclude_from_pr_ratio: false,
    id: 'p-realplay',
    name: 'RealPlay',
    key: 'RPL',
    repo_owner: 'ac3charland',
    repo_name: 'realplay',
    github_url: null,
    ref_seq: 0,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    color: null,
    description: null,
    exclude_from_pr_ratio: false,
    id: 'p-alfred',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2026-02-01T00:00:00Z',
  },
];

/** The seven days ending at a Friday-afternoon request — rolling, so neither end is midnight. */
const WEEK = {
  start: '2026-07-17T16:00:00-04:00',
  end: '2026-07-24T16:00:00-04:00',
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

const WITH_OTHER: PrRatioResponse = {
  week: WEEK,
  total: 12,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 25 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 50 },
  ],
  other: { count: 3, percentage: 25 },
};

const EMPTY_WINDOW: PrRatioResponse = {
  week: WEEK,
  total: 0,
  repos: SPLIT.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
  other: { count: 0, percentage: 0 },
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
      <CodeProvider initialProjects={PROJECTS} initialEpics={[]} initialStories={[]}>
        <div data-testid="pr-ratio-frame" className="w-[760px] bg-background p-4">
          <Story />
        </div>
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof PrRatio>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The resting state: a stacked bar whose segments are sized by each project's share, plus a
 * legend giving every project that merged a PR its percentage and its raw count. Each project
 * wears the colour it wears everywhere else in the Code module, and its legend row links to its
 * board. The percentages sum to exactly 100 — largest-remainder rounding, so the classic
 * "33% / 66%" bar can't happen.
 */
export const Ready: Story = {
  decorators: [stubEndpoint(200, SPLIT)],
};

/**
 * The same window with the "Other" bucket populated: PRs merged in repos that aren't any
 * project's. It always sits last, wears a de-emphasized neutral rather than a project colour,
 * and is plain text — it isn't one place, so it has nowhere to link.
 */
export const WithOther: Story = {
  decorators: [stubEndpoint(200, WITH_OTHER)],
};

/**
 * Other measured but empty — nothing merged outside the project repos. The entry is
 * dropped rather than shown at 0%, since a zero row tells the reader nothing.
 */
export const OtherEmpty: Story = {
  decorators: [stubEndpoint(200, { ...SPLIT, other: { count: 0, percentage: 0 } })],
};

/**
 * A project that merged nothing this window (ALF-284): its legend row is dropped the same way
 * Other's is when empty, rather than sitting there at 0%. RealPlay merged no PRs; only Alfred,
 * which merged all nine, gets a row.
 */
export const ProjectEmpty: Story = {
  decorators: [
    stubEndpoint(200, {
      ...SPLIT,
      repos: SPLIT.repos.map((repo) =>
        repo.label === 'Alfred'
          ? { ...repo, count: 9, percentage: 100 }
          : { ...repo, count: 0, percentage: 0 },
      ),
    }),
  ],
};

/**
 * Seven days that genuinely haven't seen a merge. A muted line rather than an empty bar,
 * because a zero-width bar reads as broken, not as zero.
 */
export const ZeroTotal: Story = {
  decorators: [stubEndpoint(200, EMPTY_WINDOW)],
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

/**
 * `LegendKeyboardFocus`'s own capture frame. At the meta's 760px the ring — a thin stroke — is
 * under 1% of the capture, so a dropped ring would still pass the test-runner's threshold; at
 * 200px it isn't. Padded so the card's own border isn't flush against the capture edge.
 */
function withNarrowFocusFrame(Story: React.ComponentType) {
  return (
    <div data-testid="pr-ratio-focus-frame" className="inline-flex w-[200px] p-2">
      <Story />
    </div>
  );
}

/**
 * Tabbing into the card lands on the first project's legend row and draws the app's blue focus
 * ring around it. Other is not focusable, so it never takes the ring. Captured in its own
 * narrow frame (`withNarrowFocusFrame`) so a missing ring fails the snapshot.
 *
 * Declared ahead of `LegendHover` on purpose: the test-runner's real pointer stays wherever the
 * last story hovered it, so a focus capture taken after that hover would carry the underline too.
 */
export const LegendKeyboardFocus: Story = {
  parameters: {
    visualTest: { target: '[data-testid="pr-ratio-focus-frame"]', focus: true },
  },
  decorators: [withNarrowFocusFrame, stubEndpoint(200, WITH_OTHER)],
};

/** Hovering a project's legend row underlines its name — the row is a link to its board. */
export const LegendHover: Story = {
  parameters: {
    // The hover and the capture share one target, so aim both at the first legend link.
    visualTest: { target: '[data-testid="pr-ratio-frame"] a', hover: true },
  },
  decorators: [stubEndpoint(200, WITH_OTHER)],
};
