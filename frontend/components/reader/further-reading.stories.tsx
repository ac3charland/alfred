import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ToastViewport } from '@/components/shell/toast-viewport';
import {
  NO_READER_HEALTH,
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
} from '@/lib/reader/fixtures';
import { ReaderProvider, useReaderPosts } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderPostListItem } from '@/lib/types';

import { FurtherReading } from './further-reading';

/**
 * The four states a post's Further reading draws, on the Import AI mockup's four links:
 * picking (two ticked, the bar with both sends), after sends (one in Reader, one in Instapaper),
 * one send failed (the partial toast, the failed link still ticked), and a deployment with no
 * Instapaper credentials (a plain list of links). Each story seeds its own `ReaderProvider` and
 * reads its row back from it, as the overview does, so a send redraws the section.
 */

const POST_ID = '22222222-2222-4222-8222-222222222222';
const ITEMS = makeFurtherReading();
const [GAP, , FOLDBENCH, SCEPTIC] = ITEMS.map((item) => item.url) as [
  string,
  string,
  string,
  string,
];

function post(sent: { reader?: string[]; instapaper?: string[] } = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost('pub-import-ai', {
    id: POST_ID,
    received_at: '2026-09-16T14:00:00.000Z',
    summary_state: 'done',
    overview: makeReaderOverview({ further_reading: ITEMS }),
    further_sent_reader: sent.reader ?? [],
    further_sent_instapaper: sent.instapaper ?? [],
  });
  return row;
}

/** The section as the overview mounts it: fed from the store. */
function LiveFurtherReading() {
  const row = useReaderPosts().find((candidate) => candidate.id === POST_ID);
  if (row === undefined) return null;
  return (
    <FurtherReading
      postId={row.id}
      items={ITEMS}
      sentReader={row.further_sent_reader}
      sentInstapaper={row.further_sent_instapaper}
    />
  );
}

const withProviders: Decorator = (Story, context) => {
  const row = context.args['post'] as ReaderPostListItem;
  const configured = context.parameters['instapaperConfigured'] as boolean | undefined;
  return (
    <ToastProvider>
      <ReaderProvider
        initialPosts={[row]}
        initialHealth={NO_READER_HEALTH}
        instapaperConfigured={configured ?? true}
      >
        <div data-testid="further-reading-frame" className="w-[640px] bg-background p-4">
          <Story />
        </div>
      </ReaderProvider>
      <ToastViewport />
    </ToastProvider>
  );
};

/** The story's one arg: the row the provider is seeded with. */
interface StoryArgs {
  post: ReaderPostListItem;
}

const meta = {
  title: 'Reader/FurtherReading',
  decorators: [withProviders],
  render: () => <LiveFurtherReading />,
  args: { post: post() },
  parameters: { visualTest: { target: '[data-testid="further-reading-frame"]' } },
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Picking: two links ticked, and the bar with its count, Send to Reader, Send to Instapaper and Clear. */
export const Picking: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: /sim-to-real gap/ }));
    await userEvent.click(canvas.getByRole('checkbox', { name: /Why most robotics evals/ }));
    await expect(await canvas.findByText('2 selected')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Send to Reader' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Send to Instapaper' })).toBeEnabled();
  },
};

/** After sends: one link In Reader, in the Reader's green; one In Instapaper, muted. */
export const AfterSends: Story = {
  args: { post: post({ reader: [GAP], instapaper: [FOLDBENCH] }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('In Reader')).toBeInTheDocument();
    await expect(canvas.getByText('In Instapaper')).toBeInTheDocument();
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(2);
  },
};

/**
 * One send failed: two ticked and sent to the Reader, one landed. The toast says so, the landed
 * link reads In Reader, and the other stays ticked for a retry. The route is stubbed to answer
 * the partial send, and the capture takes the whole page so the toast is in it.
 */
export const OneSendFailed: Story = {
  parameters: { visualTest: { target: 'body' } },
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        Response.json({
          post: post({ reader: [GAP] }),
          unsent: [SCEPTIC],
          failure: "Instapaper didn't answer",
        }),
      );
    return () => {
      globalThis.fetch = original;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: /sim-to-real gap/ }));
    await userEvent.click(canvas.getByRole('checkbox', { name: /A sceptic/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Send to Reader' }));
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByText("Sent 1 of 2 to Reader — Instapaper didn't answer for the other"),
    ).toBeInTheDocument();
    await expect(await canvas.findByText('1 selected')).toBeInTheDocument();
  },
};

/** No Instapaper: a deployment without the credentials draws a plain list of links. */
export const NoInstapaper: Story = {
  parameters: { instapaperConfigured: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('link', { name: 'FoldBench v2 release notes' }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
