import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ToastViewport } from '@/components/shell/toast-viewport';
import { NO_READER_HEALTH, makeReaderOverview, makeReaderPost } from '@/lib/reader/fixtures';
import { ReaderSettingsProvider } from '@/lib/stores/reader-settings-store';
import { ReaderProvider, useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderFurtherReading, ReaderPostListItem } from '@/lib/types';

import { PostRow } from './post-row';

/**
 * The Further reading section closing an expanded row's overview, one story per state it draws:
 * two links ticked with the selection bar, links already sent (to the Reader and to Instapaper),
 * a send that part-landed, and a deployment with no Instapaper, where it is a plain list.
 * `parameters.instapaperConfigured` says whether the story's deployment can send; it defaults to
 * true, as in production.
 */

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

const MODEL_COSTS: ReaderFurtherReading = {
  url: 'https://example.com/ai-model-costs',
  title: 'The real cost of a frontier model',
  note: 'The source of the training-cost figures the post leans on.',
};
const BENCHMARKS: ReaderFurtherReading = {
  url: 'https://example.com/benchmark-roundup',
  title: 'This month in benchmark releases',
  note: 'The roundup the first section summarises; has the raw numbers.',
};
const REBUTTAL: ReaderFurtherReading = {
  url: 'https://example.com/sim-to-real-rebuttal',
  title: 'Why sim-to-real gaps are overstated',
  note: 'The strongest counter-argument to the robotics result.',
};
const BACKGROUND: ReaderFurtherReading = {
  url: 'https://example.com/folding-task-explainer',
  title: 'A primer on the folding task',
  note: 'Background for anyone new to the evaluation.',
};
const ITEMS = [MODEL_COSTS, BENCHMARKS, REBUTTAL, BACKGROUND];

function roundupPost(sentReader: string[] = [], sentInstapaper: string[] = []): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost(PUBLICATION_ID, {
    id: 'p-roundup',
    author: 'Jane Doe',
    title: 'The week in benchmark releases',
    received_at: '2026-09-16T14:00:00.000Z',
    word_count: 2100,
    canonical_url: 'https://janedoe.substack.com/p/the-week-in-benchmark-releases',
    summary_state: 'done',
    gist: 'Two of the three releases this week are re-releases with new baselines; the robotics result is the one to read.',
    overview: { ...makeReaderOverview(), further_reading: ITEMS },
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-16T14:05:00.000Z',
    further_sent_reader: sentReader,
    further_sent_instapaper: sentInstapaper,
  });
  return row;
}

const withFrame: Decorator = (Story) => (
  <div data-testid="row-frame" className="w-[640px] bg-background p-2">
    <Story />
  </div>
);

/** The row's own Reader store, plus a toast viewport so a send's toast is drawn. */
const withProviders: Decorator = (Story, context) => {
  const row = context.args['post'] as ReaderPostListItem;
  const configured = context.parameters['instapaperConfigured'] as boolean | undefined;
  return (
    <>
      <ReaderProvider
        initialPosts={[row]}
        initialHealth={NO_READER_HEALTH}
        instapaperConfigured={configured ?? true}
      >
        <ReaderSettingsProvider initialPublications={[]} initialCandidates={[]}>
          <Story />
        </ReaderSettingsProvider>
      </ReaderProvider>
      <ToastViewport />
    </>
  );
};

/**
 * The row drawn from the STORE's copy of the post rather than the args' — the list does the same.
 * A send replaces the store's row with the server's answer, and only a row read from the store
 * shows the marks that answer carries; a row rendered straight from args would keep showing the
 * state it was seeded with after any send.
 */
function StoreRow({ post, now }: { post: ReaderPostListItem; now: Date }) {
  const current = useReaderPosts().find((row) => row.id === post.id) ?? post;
  return <PostRow post={current} now={now} />;
}

const meta = {
  title: 'Reader/FurtherReading',
  component: StoreRow,
  decorators: [withFrame, withProviders],
  args: { now: NOW, post: roundupPost() },
} satisfies Meta<typeof StoreRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const VISUAL_TEST = { target: '[data-testid="row-frame"]' };

async function openOverview(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Overview' }));
}

async function tick(canvasElement: HTMLElement, ...titles: string[]): Promise<void> {
  const canvas = within(canvasElement);
  for (const title of titles) {
    await userEvent.click(await canvas.findByRole('checkbox', { name: new RegExp(title) }));
  }
}

/** Two links ticked: the selection bar under the list, with its count and both send buttons. */
export const Picking: Story = {
  parameters: { visualTest: VISUAL_TEST },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    await tick(canvasElement, 'real cost', 'sim-to-real');
    await expect(await within(canvasElement).findByText('2 selected')).toBeInTheDocument();
  },
};

/** One link already in the Reader, one in Instapaper: their marks, the rest still tickable. */
export const AfterSends: Story = {
  args: { post: roundupPost([MODEL_COSTS.url], [BENCHMARKS.url]) },
  parameters: { visualTest: VISUAL_TEST },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('In Reader')).toBeInTheDocument();
    await expect(canvas.getByText('In Instapaper')).toBeInTheDocument();
  },
};

/**
 * Two links sent, Instapaper answering for only one: the answered link wears its In Reader mark,
 * the other stays ticked for a retry, and the toast says how many went. The send route is
 * stubbed to answer that way, so the story drives the real press-send-toast path; the toast
 * itself sits in the fixed viewport, outside the captured frame.
 */
export const OneSendFailed: Story = {
  parameters: { visualTest: VISUAL_TEST },
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        Response.json({
          post: roundupPost([MODEL_COSTS.url]),
          unsent: [REBUTTAL.url],
          failure: "Instapaper didn't answer",
        }),
      );
    return () => {
      globalThis.fetch = original;
    };
  },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    await tick(canvasElement, 'real cost', 'sim-to-real');
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Send to Reader' }));
    await expect(await canvas.findByText('In Reader')).toBeInTheDocument();
    await expect(
      await within(document.body).findByText(
        "Sent 1 of 2 to Reader — Instapaper didn't answer for the other",
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByRole('checkbox', { name: /sim-to-real/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};

/** No Instapaper on this deployment: a plain list of links, with no ticks and no bar. */
export const NoInstapaper: Story = {
  parameters: { instapaperConfigured: false, visualTest: VISUAL_TEST },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: MODEL_COSTS.title })).toBeInTheDocument();
    await expect(canvas.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
