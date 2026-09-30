import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ToastViewport } from '@/components/shell/toast-viewport';
import {
  NO_READER_HEALTH,
  makeFurtherReading,
  makeReaderArticle,
  makeReaderOverview,
  makeReaderPost,
  makeResearchPost,
} from '@/lib/reader/fixtures';
import { ReaderSettingsProvider } from '@/lib/stores/reader-settings-store';
import { ReaderProvider, useReaderPosts } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type {
  FurtherReadingSendResult,
  ReaderFurtherReading,
  ReaderOverview,
  ReaderPostListItem,
} from '@/lib/types';

import { PostRow } from './post-row';

/**
 * One story per row state the reading list can show: a finished summary (collapsed and
 * expanded), the three floor states, a post with no web link, the Send verb disabled for each of
 * its two reasons, and a sent post in the archive. Each is its own `ReaderProvider` seed (rather
 * than the shared shell seed) so its verbs have something real to act on in an isolated story.
 * `parameters.instapaperConfigured` says whether the story's deployment can send; it defaults to
 * true, as in production.
 *
 * The `Wiki…` stories are the Novel-ideas checklist on a deployment that can write into the
 * wiki (the preview's `store.wiki.writable`), one per state it draws: nothing ticked beside a
 * bullet sent earlier, two ticked with the selection bar, the send in flight, and every bullet
 * sent. `WikiNotConnected` is that same post with the wiki not connected — the plain list
 * `DoneExpanded` also draws.
 *
 * The `Research…` stories are a research post in the four states its row draws: the question
 * while the session works, no report (a refused fire), a delivered report waiting on its summary,
 * and a summarised report with its overview open and the wiki checklists live. Every timestamp is
 * stated against the fixed clock, so nothing drifts into or out of being stale.
 *
 * The `FurtherReading…` stories are the last overview section, on a roundup that links four
 * pieces: the checklist being picked from, after two sends (one into the Reader, one to
 * Instapaper), after a send that saved one link of two (the toast under the row, the failed
 * link still ticked), and on a deployment without Instapaper, where it is a plain list of links.
 */

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, html: _html, ...listItem } = makeReaderPost(PUBLICATION_ID, overrides);
  return listItem;
}

/** An article from Instapaper's To Reader folder, as the list carries it. */
function article(overrides: Parameters<typeof makeReaderArticle>[0] = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...listItem
  } = makeReaderArticle({
    received_at: '2026-09-18T08:30:00.000Z',
    instapaper_bookmark_id: 1_900_001,
    ...overrides,
  });
  return listItem;
}

const withFrame: Decorator = (Story) => (
  <div data-testid="row-frame" className="w-[640px] bg-background p-2">
    <Story />
  </div>
);

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
        <ReaderSettingsProvider initialPublications={[]} initialCandidates={[]}>
          <Story />
        </ReaderSettingsProvider>
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

/**
 * No canonical URL and no captured Message-ID: nowhere for Original to point, so there is no
 * Original link at all — and Send still works, as a private bookmark carrying the post's body.
 */
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

/**
 * Send disabled: no web link, and the retention sweep took the body — nothing Instapaper could
 * save. The button stays in the leading slot, disabled, with a title saying why.
 */
export const SendNothingToSend: Story = {
  args: {
    post: post({
      id: 'p-nothing-to-send',
      author: 'Stratechery',
      title: '(untitled)',
      received_at: '2026-06-14T14:00:00.000Z',
      word_count: 0,
      canonical_url: null,
      rfc822_message_id: '<untitled@mail.stratechery.com>',
      summary_state: 'failed',
      last_error: 'no readable body',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Send disabled: this deployment has no Instapaper credentials (local dev). */
export const SendNotConfigured: Story = {
  args: { selected: true },
  parameters: {
    instapaperConfigured: false,
    visualTest: { target: '[data-testid="row-frame"]' },
  },
};

/** The archive after a send: the in Instapaper badge, and Unarchive in Archive's slot. */
export const SentInArchive: Story = {
  args: {
    variant: 'archive',
    post: post({
      id: 'p-sent',
      author: 'Second Thoughts',
      title: 'How near is the intelligence explosion, really?',
      received_at: '2026-09-16T14:00:00.000Z',
      word_count: 3220,
      html_extracted: true,
      canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      summary_state: 'done',
      gist:
        'Argues the "recursive self-improvement" debate conflates three different feedback loops ' +
        'and that only one of them (automated ML research) has any evidence behind it.',
      overview: makeReaderOverview(),
      model: 'claude-sonnet-5',
      prompt_version: 2,
      summarized_at: '2026-09-16T14:05:00.000Z',
      archived_at: '2026-09-17T09:00:00.000Z',
      instapaper_sent_at: '2026-09-17T09:00:00.000Z',
      instapaper_bookmark_id: 1_234_567,
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

// ---------------------------------------------------------------------------
// The Novel-ideas and Evidence checklists, with the wiki connected
// ---------------------------------------------------------------------------

const HABIT = 'Habit stacking works because the cue is an existing routine, not a time of day.';
const ENVIRONMENT = 'Environment design beats willpower for the first thirty days.';
const STREAKS =
  'Streak-tracking helps only until the first miss; after that, "never miss twice" matters more.';
const IDENTITY = 'Identity-based framing ("I’m a runner") outlasts outcome goals.';
const HABIT_IDEAS = [HABIT, ENVIRONMENT, STREAKS, IDENTITY];

const LALLY = 'Lally et al. (2010): median 66 days to automaticity, ranging from 18 to 254.';
const SURVEY =
  'A survey of 2,000 habit-app users: streak users lapsed 40% more often after a first miss.';
const LOG = "The author's own 90-day log, n=1, flagged as such.";
const HABIT_EVIDENCE = [LALLY, SURVEY, LOG];

interface HabitsPostOptions {
  novelIdeas?: string[];
  evidence?: string[];
  wikiSentEvidence?: string[];
}

function habitsPost(
  wikiSentIdeas: string[],
  {
    novelIdeas = HABIT_IDEAS,
    evidence = HABIT_EVIDENCE,
    wikiSentEvidence = [],
  }: HabitsPostOptions = {},
): ReaderPostListItem {
  return post({
    id: 'p-habits',
    author: 'Jane Doe',
    title: 'Why habits stick',
    received_at: '2026-09-16T14:00:00.000Z',
    word_count: 1640,
    canonical_url: 'https://janedoe.substack.com/p/why-habits-stick',
    summary_state: 'done',
    gist: "Routines anchored to an existing cue survive; routines anchored to a clock time don't.",
    overview: makeReaderOverview({ novel_ideas: novelIdeas, evidence }),
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-16T14:05:00.000Z',
    wiki_sent_ideas: wikiSentIdeas,
    wiki_sent_evidence: wikiSentEvidence,
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

/**
 * Nothing ticked, one idea sent earlier: the sent check, and Select all on both sections'
 * heading rows. Nothing is ticked, so there is no selection bar.
 */
export const WikiNothingTicked: Story = {
  args: { post: habitsPost([HABIT]) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('button', { name: 'Select all Novel ideas' }),
    ).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Select all Evidence' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: /Send all/ })).not.toBeInTheDocument();
  },
};

/** Two ideas ticked: the selection bar under Evidence, with its count, Send to wiki and Clear. */
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

/**
 * Every bullet in both sections sent: each row checked in violet, and "All sent to wiki" in each
 * section's Select all place. Nothing is left to tick, so there is no bar.
 */
export const WikiAllSent: Story = {
  args: { post: habitsPost(HABIT_IDEAS, { wikiSentEvidence: HABIT_EVIDENCE }) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findAllByText('All sent to wiki')).toHaveLength(2);
    await expect(canvas.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};

/** One idea and one piece of evidence ticked: one selection, counted in one bar under Evidence. */
export const WikiPickedAcrossSections: Story = {
  args: { post: habitsPost([HABIT]) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: ENVIRONMENT }));
    await userEvent.click(await canvas.findByRole('checkbox', { name: LALLY }));
    await expect(await canvas.findByText('2 selected')).toBeInTheDocument();
    await expect(canvas.getAllByRole('group', { name: 'Selected bullets' })).toHaveLength(1);
  },
};

/**
 * After a send of an idea and a piece of evidence: the streaks idea ticked by hand, then
 * Evidence's Select all. Both sections read Deselect all — every unsent bullet in each is
 * ticked — and the bar counts all three, still unsent.
 */
export const WikiSelectAllEvidence: Story = {
  args: { post: habitsPost([HABIT, ENVIRONMENT, IDENTITY], { wikiSentEvidence: [LALLY] }) },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: STREAKS }));
    await userEvent.click(canvas.getByRole('button', { name: 'Select all Evidence' }));
    await expect(await canvas.findByText('3 selected')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Deselect all Evidence' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Deselect all Novel ideas' })).toBeEnabled();
  },
};

/**
 * A post with no novel ideas: Novel ideas keeps its honest empty line at its normal height, and
 * Evidence alone is a checklist, with the bar under it.
 */
export const WikiEvidenceOnly: Story = {
  args: {
    post: habitsPost([], {
      novelIdeas: [],
      evidence: [
        'Three eval releases with links; the robotics one includes raw per-task numbers.',
        'An internal replication the author ran, n=1, flagged as such.',
      ],
    }),
  },
  parameters: WIKI_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('checkbox', {
        name: 'An internal replication the author ran, n=1, flagged as such.',
      }),
    );
    await expect(await canvas.findByText('1 selected')).toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: 'Select all Novel ideas' }),
    ).not.toBeInTheDocument();
  },
};

/**
 * The same post with the wiki NOT connected (no wiki token, `writable: false`): Novel ideas
 * and Evidence are the plain bulleted lists, with no tick boxes, no Select all and no selection
 * bar. Its one evidence bullet is the one this baseline was first captured with, so the capture
 * proves the plain view did not move.
 */
export const WikiNotConnected: Story = {
  args: {
    post: habitsPost([], {
      evidence: ['Lally et al. (2010): median 66 days to automaticity.'],
    }),
  },
  parameters: {
    ...WIKI_PARAMETERS,
    store: { wiki: { writable: false } },
  },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(HABIT)).toBeInTheDocument();
    await expect(canvas.queryByRole('checkbox')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Further reading, the overview's last section
// ---------------------------------------------------------------------------

const FURTHER = makeFurtherReading();
const [SIM_TO_REAL, EVALS_DONT_TRANSFER, , SCEPTICS_REPLY] = FURTHER as [
  ReaderFurtherReading,
  ReaderFurtherReading,
  ReaderFurtherReading,
  ReaderFurtherReading,
];

function roundupPost(sent: { reader?: string[]; instapaper?: string[] } = {}): ReaderPostListItem {
  return post({
    id: 'p-roundup',
    author: 'Import AI',
    title: 'Import AI 412: Robots that fold, and evals that do not transfer',
    received_at: '2026-09-16T14:00:00.000Z',
    word_count: 2480,
    canonical_url: 'https://importai.example.com/p/import-ai-412',
    summary_state: 'done',
    gist: 'A roundup whose lead item is a folding benchmark where simulation and hardware disagree.',
    overview: makeReaderOverview({ further_reading: FURTHER }),
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-16T14:05:00.000Z',
    further_sent_reader: sent.reader ?? [],
    further_sent_instapaper: sent.instapaper ?? [],
  });
}

const FURTHER_PARAMETERS = { visualTest: { target: '[data-testid="row-frame"]' } };

/**
 * The four links unticked, each with its open link: Select all on the heading row, and no bar
 * while nothing is ticked.
 */
export const FurtherReadingPicking: Story = {
  args: { post: roundupPost() },
  parameters: FURTHER_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: EVALS_DONT_TRANSFER.title }));
    await userEvent.click(await canvas.findByRole('checkbox', { name: SCEPTICS_REPLY.title }));
    await expect(await canvas.findByText('2 selected')).toBeInTheDocument();
    // The row's own Send verb is also "Send to Instapaper", so the bar's buttons are found in it.
    const bar = within(canvas.getByRole('group', { name: 'Selected links' }));
    await expect(bar.getByRole('button', { name: 'Send to Reader' })).toBeEnabled();
    await expect(bar.getByRole('button', { name: 'Send to Instapaper' })).toBeEnabled();
  },
};

/**
 * Two links already sent: one into the Reader (green), one to Instapaper (muted). Each keeps its
 * open link, and the other two are still there to tick.
 */
export const FurtherReadingAfterSends: Story = {
  args: { post: roundupPost({ reader: [SIM_TO_REAL.url], instapaper: [EVALS_DONT_TRANSFER.url] }) },
  parameters: FURTHER_PARAMETERS,
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('In Reader')).toBeInTheDocument();
    await expect(canvas.getByText('In Instapaper')).toBeInTheDocument();
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(2);
  },
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** What the route answers to a send of two links that saved only the first. */
const PARTIAL_SEND: FurtherReadingSendResult = {
  post: roundupPost({ reader: [SIM_TO_REAL.url] }),
  unsent: [EVALS_DONT_TRANSFER.url],
  failure: "Instapaper didn't answer",
};

/**
 * The row as the list draws it: from the store, so a send that replaces the post redraws it. A
 * story's `post` arg is only the seed; `PostRow` itself takes whatever row it is handed.
 */
function LivePostRow(properties: React.ComponentProps<typeof PostRow>) {
  const row = useReaderPosts().find((candidate) => candidate.id === properties.post.id);
  return <PostRow {...properties} post={row ?? properties.post} />;
}

/** The toast belongs to the viewport's corner; in a frame it sits under the row instead. */
const withToastUnderRow: Decorator = (Story) => (
  <div className="relative pb-28 [transform:translateZ(0)]">
    <Story />
    <ToastViewport />
  </div>
);

/**
 * Two ticked, sent to the Reader, one saved: the saved link is marked, the other stays ticked so
 * the retry is one press, and the toast says what stopped it.
 */
export const FurtherReadingOneSendFailed: Story = {
  args: { post: roundupPost() },
  parameters: FURTHER_PARAMETERS,
  decorators: [withToastUnderRow],
  render: (args) => <LivePostRow {...args} />,
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = (input) =>
      requestUrl(input).includes('/further-reading')
        ? Promise.resolve(
            Response.json(PARTIAL_SEND, {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : new Promise(() => {});
    return () => {
      globalThis.fetch = original;
    };
  },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: SIM_TO_REAL.title }));
    await userEvent.click(await canvas.findByRole('checkbox', { name: EVALS_DONT_TRANSFER.title }));
    await userEvent.click(canvas.getByRole('button', { name: 'Send to Reader' }));
    await expect(
      await canvas.findByText("Sent 1 of 2 to Reader — Instapaper didn't answer for the other"),
    ).toBeInTheDocument();
    await expect(await canvas.findByText('In Reader')).toBeInTheDocument();
    await expect(canvas.getByRole('checkbox', { name: EVALS_DONT_TRANSFER.title })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};

/**
 * A deployment without Instapaper credentials: the section is a plain list of links, each title
 * the link with its note after it — no ticks, no Select all, no bar.
 */
export const FurtherReadingNoInstapaper: Story = {
  args: { post: roundupPost() },
  parameters: { ...FURTHER_PARAMETERS, instapaperConfigured: false },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: SIM_TO_REAL.title })).toHaveAttribute(
      'href',
      SIM_TO_REAL.url,
    );
    await expect(canvas.queryByRole('checkbox')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument();
  },
};

/**
 * An article the To Reader leg took in from Instapaper and summarised: its site as the eyebrow,
 * "via Instapaper" closing the meta line, and every verb a newsletter row has.
 */
export const InstapaperSummarised: Story = {
  args: {
    post: article({
      id: 'p-article-done',
      summary_state: 'done',
      gist:
        'Argues that falling street-level noise in six US downtowns tracks lost foot traffic ' +
        'rather than new ordinances, using city sensor data from 2019–2026. The sensor analysis ' +
        'is new; the policy prescription is the familiar one. Read the data section; skip the ' +
        'last third.',
      overview: makeReaderOverview(),
      model: 'claude-sonnet-5',
      prompt_version: 1,
      summarized_at: '2026-09-18T08:31:00.000Z',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Just taken in: the post is leased and waiting on its summary, with the newsletter's floor. */
export const InstapaperArriving: Story = {
  args: { post: article({ id: 'p-article-arriving', summary_state: 'pending' }) },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Instapaper had no text for it (error 1550): filed failed, with its Original link still there. */
export const InstapaperNoText: Story = {
  args: {
    post: article({
      id: 'p-article-no-text',
      title: 'A page Instapaper couldn’t parse',
      site: 'example.org',
      canonical_url: 'https://example.org/interactive/a-page',
      word_count: 0,
      html_extracted: false,
      summary_state: 'failed',
      last_error: 'no readable body',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

// ---------------------------------------------------------------------------
// A research post: the question while its report is written, then the report
// ---------------------------------------------------------------------------

const QUESTION = 'Is a cold-climate heat pump worth it for our Chicago house?';
const SESSION_URL = 'https://claude.ai/code/session_01ResearchStory';

/** An ISO instant `minutes` before the fixed clock. */
function minutesBeforeNow(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

/** A research post as the list carries it: no bodies, no brief. */
function research(overrides: Parameters<typeof makeResearchPost>[0] = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    research_brief: _brief,
    ...listItem
  } = makeResearchPost({
    title: QUESTION,
    research_session_url: SESSION_URL,
    ...overrides,
  });
  return listItem;
}

/** The session is underway: a fire accepted twenty minutes ago, no report yet. */
export const ResearchResearching: Story = {
  args: {
    post: research({
      id: 'p-research-running',
      received_at: minutesBeforeNow(20),
      created_at: minutesBeforeNow(20),
      research_state: 'researching',
      research_fired_at: minutesBeforeNow(19),
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Send to Instapaper' })).toBeDisabled();
    await expect(canvas.getByRole('link', { name: 'Session' })).toHaveAttribute(
      'href',
      SESSION_URL,
    );
  },
};

/**
 * The Routine refused the fire: the alert badge, the row dimmed, the refusal's reason in the
 * line, and Retry research in Send's place (research is configured on this deployment).
 */
export const ResearchNoReport: Story = {
  args: {
    post: research({
      id: 'p-research-failed',
      received_at: minutesBeforeNow(25),
      created_at: minutesBeforeNow(25),
      research_state: 'failed',
      research_session_url: null,
      research_error: 'the Routine’s daily run cap or usage limit was reached',
    }),
  },
  parameters: {
    store: { researchConfigured: true },
    visualTest: { target: '[data-testid="row-frame"]' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Retry research' })).toBeEnabled();
    await expect(
      canvas.queryByRole('button', { name: 'Send to Instapaper' }),
    ).not.toBeInTheDocument();
  },
};

/** The report has arrived and the Worker has not reached it: sendable at once, Session beside Archive. */
export const ResearchSummarising: Story = {
  args: {
    post: research({
      id: 'p-research-summarising',
      received_at: minutesBeforeNow(5),
      created_at: minutesBeforeNow(70),
      research_state: 'done',
      research_fired_at: minutesBeforeNow(69),
      research_delivered_at: minutesBeforeNow(5),
      word_count: 2530,
      summary_state: 'pending',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/**
 * A summarised report with its overview open: Novel ideas and Evidence as wiki checklists (one
 * idea ticked, so the selection bar is up), and Session in the footer where Original would be.
 */
export const ResearchDoneExpanded: Story = {
  args: {
    post: research({
      id: 'p-research-done',
      received_at: minutesBeforeNow(5),
      created_at: minutesBeforeNow(70),
      research_state: 'done',
      research_fired_at: minutesBeforeNow(69),
      research_delivered_at: minutesBeforeNow(5),
      word_count: 2530,
      summary_state: 'done',
      gist:
        'Probably yes if the furnace is near the end of its life: a cold-climate unit carries the ' +
        'house to about −15°F on its own, and the rebate decides payback. The report works the ' +
        'arithmetic for your case and flags the one number it couldn’t pin down.',
      overview: makeReaderOverview({
        novel_ideas: [
          'Size for the heating design day, not the cooling load — the opposite of the usual AC rule.',
          'Keep the furnace as backup for the coldest week rather than a resistance strip.',
        ],
        evidence: [
          'Two cold-climate field studies of whole-house heating through sub-zero weeks.',
          'The state rebate schedule and the utility’s heat-pump rate.',
        ],
        argument:
          'Capacity at design temperature is no longer the blocker; running cost is, and it turns ' +
          'on the gas-to-electric price ratio…',
        who_should_read:
          'You, before calling installers; the summary is enough to decide whether to get quotes.',
      }),
      model: 'claude-sonnet-5',
      prompt_version: 1,
      summarized_at: minutesBeforeNow(4),
    }),
  },
  parameters: {
    store: {
      researchConfigured: true,
      wiki: { repo: 'ac3charland/knowledge', writable: true },
    },
    visualTest: { target: '[data-testid="row-frame"]' },
  },
  play: async ({ canvasElement }) => {
    await openOverview(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('checkbox', {
        name: 'Size for the heating design day, not the cooling load — the opposite of the usual AC rule.',
      }),
    );
    await expect(await canvas.findByText('1 selected')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Session' })).toHaveAttribute(
      'href',
      SESSION_URL,
    );
  },
};
