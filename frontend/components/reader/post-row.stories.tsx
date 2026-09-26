import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { NO_READER_HEALTH, makeReaderOverview, makeReaderPost } from '@/lib/reader/fixtures';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { PostRow } from './post-row';

/**
 * One story per row state the reading list can show: a finished summary (collapsed and
 * expanded), the three floor states, and a post with nowhere for "Open" to point. Each is its
 * own `ReaderProvider` seed (rather than the shared shell seed) so its archive/open verbs have
 * something real to act on in an isolated story.
 *
 * The `Wiki…` stories are the Novel-ideas checklist on a deployment that can write into the
 * wiki (the preview's `store.wiki.writable`), one per state it draws: nothing ticked beside a
 * bullet sent earlier, two ticked with the selection bar, the send in flight, and every bullet
 * sent. `DoneExpanded` is the same section with the wiki not connected — today's plain list.
 */

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, overrides);
  return listItem;
}

const withFrame: Decorator = (Story) => (
  <div data-testid="row-frame" className="w-[640px] bg-background p-2">
    <Story />
  </div>
);

const withProviders: Decorator = (Story, context) => {
  const row = context.args['post'] as ReaderPostListItem;
  return (
    <ToastProvider>
      <ReaderProvider initialPosts={[row]} initialHealth={NO_READER_HEALTH}>
        <Story />
      </ReaderProvider>
    </ToastProvider>
  );
};

const meta = {
  title: 'Reader/PostRow',
  component: PostRow,
  decorators: [withFrame, withProviders],
  args: {
    now: NOW,
    post: post({
      id: 'p-done',
      author: 'Second Thoughts',
      title: 'How near is the intelligence explosion, really?',
      received_at: '2026-09-16T14:00:00.000Z',
      word_count: 3220,
      html_extracted: true,
      canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      summary_state: 'done',
      gist:
        'Argues the "recursive self-improvement" debate conflates three different feedback loops ' +
        'and that only one of them (automated ML research) has any evidence behind it. A genuinely ' +
        'new framing — worth reading if you follow the RSI argument; skip if you only want the ' +
        'conclusion.',
      overview: makeReaderOverview(),
      model: 'claude-sonnet-5',
      prompt_version: 2,
      summarized_at: '2026-09-16T14:05:00.000Z',
    }),
  },
} satisfies Meta<typeof PostRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A finished summary, collapsed — the row's ordinary resting state. */
export const DoneCollapsed: Story = {
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** The same row with its overview open, through the verb. */
export const DoneExpanded: Story = {
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Overview' }));
  },
};

/** Waiting on the tick — the muted badge, the placeholder line, no Overview verb. */
export const Pending: Story = {
  args: {
    post: post({
      id: 'p-pending',
      author: 'Stratechery',
      title: 'The AI capex question',
      received_at: '2026-09-16T14:00:00.000Z',
      word_count: 2640,
      canonical_url: 'https://stratechery.com/2026/the-ai-capex-question/',
      summary_state: 'pending',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Three counted misses — the alert badge, the schema-miss placeholder, dimmed. */
export const Failed: Story = {
  args: {
    post: post({
      id: 'p-failed',
      author: 'Astral Codex Ten',
      title: 'Open Thread 348',
      received_at: '2026-09-15T14:00:00.000Z',
      word_count: 6500,
      canonical_url: 'https://astralcodexten.substack.com/p/open-thread-348',
      summary_state: 'failed',
      summarize_attempts: 3,
      last_error: "the model's output didn't fit the schema three times",
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** The model declined — the destructive-outline badge, its own explanation, dimmed. */
export const Refused: Story = {
  args: {
    post: post({
      id: 'p-refused',
      author: 'Some Substack',
      title: 'A post the model declined',
      received_at: '2026-09-14T14:00:00.000Z',
      word_count: 420,
      canonical_url: 'https://somesubstack.substack.com/p/a-post-the-model-declined',
      summary_state: 'refused',
      last_error:
        'this post walks through exploit chains in enough operational detail that summarising ' +
        'it would mean reproducing that detail',
      model: 'claude-sonnet-5',
      prompt_version: 1,
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** No canonical URL and no captured Message-ID — Open is disabled, with a title saying why. */
export const NoLink: Story = {
  args: {
    post: post({
      id: 'p-no-link',
      author: 'Second Thoughts',
      title: "The best arguments are the ones you can't dismiss quickly",
      received_at: '2026-09-14T14:00:00.000Z',
      word_count: 980,
      canonical_url: null,
      rfc822_message_id: null,
      summary_state: 'done',
      gist:
        'A short piece distinguishing arguments you disagree with from ones you cannot ' +
        'immediately locate the flaw in.',
      overview: makeReaderOverview(),
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Mid re-summarise: the pending marker over the previous summary, dimmed, and no retry verb. */
export const Resummarising: Story = {
  args: {
    post: post({
      id: 'p-resummarising',
      author: 'Second Thoughts',
      title: 'How near is the intelligence explosion, really?',
      received_at: '2026-09-16T14:00:00.000Z',
      word_count: 3220,
      canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      summary_state: 'pending',
      gist:
        'Argues the "recursive self-improvement" debate conflates three different feedback loops ' +
        '… (the previous summary, being replaced)',
      overview: makeReaderOverview(),
      model: 'claude-sonnet-5',
      prompt_version: 1,
      summarized_at: '2026-09-16T14:05:00.000Z',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/**
 * The row the keyboard is pointing at: the ring, and a key hint beside each of the three verbs
 * it can run. Collapsed — selection and the overview are separate states.
 */
export const SelectedCollapsed: Story = {
  args: { selected: true },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** The same selected row with its overview open: the ring and the wash at once. */
export const SelectedExpanded: Story = {
  args: { selected: true },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Overview' }));
  },
};

/** The archive's row: everything the list's row is, with Unarchive in Archive's slot. */
export const ArchivedAndSelected: Story = {
  args: {
    variant: 'archive',
    selected: true,
    post: post({
      id: 'p-archived',
      author: 'Second Thoughts',
      title: 'Why every forecasting tournament converges on the same three people',
      received_at: '2026-09-12T14:00:00.000Z',
      word_count: 2400,
      html_extracted: true,
      canonical_url: 'https://secondthoughts.substack.com/p/forecasting-tournaments',
      summary_state: 'done',
      gist:
        'A selection-effects argument: the tournaments reward calibration on questions with ' +
        'short resolution windows, and the same three forecasters specialise in exactly those.',
      overview: makeReaderOverview(),
      model: 'claude-sonnet-5',
      prompt_version: 2,
      summarized_at: '2026-09-12T14:05:00.000Z',
      archived_at: '2026-09-17T09:00:00.000Z',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Refused, and its body swept: the line says why, and there is no verb that could work. */
export const RefusedAndSwept: Story = {
  args: {
    post: post({
      id: 'p-refused-swept',
      author: 'Stratechery',
      title: 'An Interview with…',
      received_at: '2026-06-09T14:00:00.000Z',
      word_count: 5060,
      canonical_url: 'https://stratechery.com/2026/an-interview-with/',
      summary_state: 'refused',
      text_swept_at: '2026-09-08T03:00:00.000Z',
      model: 'claude-sonnet-5',
      prompt_version: 1,
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

// ---------------------------------------------------------------------------
// The Novel-ideas checklist, with the wiki connected
// ---------------------------------------------------------------------------

const HABIT = 'Habit stacking works because the cue is an existing routine, not a time of day.';
const ENVIRONMENT = 'Environment design beats willpower for the first thirty days.';
const STREAKS =
  'Streak-tracking helps only until the first miss; after that, "never miss twice" matters more.';
const IDENTITY = 'Identity-based framing ("I’m a runner") outlasts outcome goals.';
const HABIT_IDEAS = [HABIT, ENVIRONMENT, STREAKS, IDENTITY];

function habitsPost(wikiSentIdeas: string[]): ReaderPostListItem {
  return post({
    id: 'p-habits',
    author: 'Jane Doe',
    title: 'Why habits stick',
    received_at: '2026-09-16T14:00:00.000Z',
    word_count: 1640,
    canonical_url: 'https://janedoe.substack.com/p/why-habits-stick',
    summary_state: 'done',
    gist: "Routines anchored to an existing cue survive; routines anchored to a clock time don't.",
    overview: makeReaderOverview({
      novel_ideas: HABIT_IDEAS,
      evidence: ['Lally et al. (2010): median 66 days to automaticity.'],
    }),
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-16T14:05:00.000Z',
    wiki_sent_ideas: wikiSentIdeas,
  });
}

const WIKI_PARAMETERS = {
  store: { wiki: { repo: 'ac3charland/knowledge', writable: true } },
  visualTest: { target: '[data-testid="row-frame"]' },
};

async function openOverview(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Overview' }));
}

async function tickTwo(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('checkbox', { name: ENVIRONMENT }));
  await userEvent.click(await canvas.findByRole('checkbox', { name: STREAKS }));
  await expect(await canvas.findByText('2 selected')).toBeInTheDocument();
}

/** Nothing ticked, one bullet sent earlier: the sent check, and Send all on the heading row. */
export const WikiNothingTicked: Story = {
  args: { post: habitsPost([HABIT]) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Send all to wiki' })).toBeEnabled();
  },
};

/** Two ticked: the selection bar under the list, with its count, Send to wiki and Clear. */
export const WikiTwoTicked: Story = {
  args: { post: habitsPost([HABIT]) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    await tickTwo(canvasElement);
  },
};

/**
 * The two on their way: every control disabled, and the pressed button reads Sending…. The
 * send route is held unanswered for the length of the story, so the capture sits mid-flight.
 */
export const WikiSending: Story = {
  args: { post: habitsPost([HABIT]) },
  parameters: WIKI_PARAMETERS,
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => new Promise(() => {});
    return () => {
      globalThis.fetch = original;
    };
  },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    await tickTwo(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Send to wiki' }));
    await expect(await canvas.findByRole('button', { name: /Sending…/ })).toBeDisabled();
  },
};

/** Every bullet sent: each row checked in violet, and "All sent to wiki" in Send all's place. */
export const WikiAllSent: Story = {
  args: { post: habitsPost(HABIT_IDEAS) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('All sent to wiki')).toBeInTheDocument();
  },
};
