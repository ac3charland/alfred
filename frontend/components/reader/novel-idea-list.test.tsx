import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderOverview, makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import { useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderPostListItem } from '@/lib/types';

import { NovelIdeaList } from './novel-idea-list';
import { renderReader } from './test-helpers';

// A partial mock: the send is stubbed, but `ApiError` stays the real class, since the store
// quotes the route's own sentence from it.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  sendReaderIdeasToWiki: jest.fn(),
}));
const mockApi = jest.mocked(api);

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const HABIT = 'Habit stacking works because the cue is an existing routine, not a time of day.';
const ENVIRONMENT = 'Environment design beats willpower for the first thirty days.';
const STREAKS = 'Streak-tracking helps only until the first miss.';
const IDENTITY = 'Identity-based framing outlasts outcome goals.';
const IDEAS = [HABIT, ENVIRONMENT, STREAKS, IDENTITY];

function post(wikiSentIdeas: string[] = []): ReaderPostListItem {
  const { text: _text, ...row } = makeReaderPost(PUBLICATION_ID, {
    id: POST_ID,
    summary_state: 'done',
    overview: makeReaderOverview({ novel_ideas: IDEAS }),
    wiki_sent_ideas: wikiSentIdeas,
  });
  return row;
}

/** The list as the row mounts it: fed from the store, so a reconciled send redraws it. */
function LiveList() {
  const row = useReaderPosts().find((candidate) => candidate.id === POST_ID);
  if (row === undefined) return null;
  return (
    <NovelIdeaList
      postId={row.id}
      ideas={IDEAS}
      sentIdeas={row.wiki_sent_ideas}
      heading={<h3>Novel ideas</h3>}
    />
  );
}

function renderList(sent: string[] = []) {
  return renderReader(<LiveList />, [post(sent)], undefined, { wikiWritable: true });
}

/** A promise the test settles by hand, so one send can be held in flight. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick(idea: string): HTMLElement {
  return screen.getByRole('checkbox', { name: idea });
}

/** The selection bar, which must be showing. */
function bar(): HTMLElement {
  return screen.getByRole('group', { name: 'Selected ideas' });
}

/** The selection bar, if it is showing — folded away, it leaves the accessibility tree. */
function queryBar(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Selected ideas' });
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('NovelIdeaList — ticking', () => {
  it('draws every unsent bullet as an unticked checkbox', () => {
    renderList();

    for (const idea of IDEAS) {
      expect(tick(idea)).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('ticks and unticks a bullet by a click anywhere on its row', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByText(ENVIRONMENT));
    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'true');

    await user.click(tick(ENVIRONMENT));
    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'false');
  });

  it('ticks a focused bullet with Space', async () => {
    const user = userEvent.setup();
    renderList();

    tick(STREAKS).focus();
    await user.keyboard(' ');

    expect(tick(STREAKS)).toHaveAttribute('aria-checked', 'true');
  });

  it('draws a sent bullet as sent, and never as something to tick', async () => {
    const user = userEvent.setup();
    renderList([HABIT]);

    expect(screen.queryByRole('checkbox', { name: HABIT })).not.toBeInTheDocument();
    expect(screen.getByText(HABIT)).toBeInTheDocument();
    expect(screen.getAllByText('Sent')).toHaveLength(1);

    await user.click(screen.getByText(HABIT));
    expect(queryBar()).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });
});

describe('NovelIdeaList — the selection bar', () => {
  it('stays folded away while nothing is ticked', () => {
    renderList();

    expect(queryBar()).not.toBeInTheDocument();
  });

  it('appears at one tick with the count, and counts every tick after', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(tick(ENVIRONMENT));
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();

    await user.click(tick(STREAKS));
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });

  it('unticks everything on Clear and folds away', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(STREAKS));

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'false');
    expect(tick(STREAKS)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
  });
});

describe('NovelIdeaList — sending', () => {
  it('sends exactly the ticked bullets in one request, then draws them sent', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(post([ENVIRONMENT, STREAKS]));
    renderList();

    // Ticked out of list order: the send still names them in the order the list draws them.
    await user.click(tick(STREAKS));
    await user.click(tick(ENVIRONMENT));
    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    await waitFor(() => {
      expect(queryBar()).not.toBeInTheDocument();
    });
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(1);
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledWith(POST_ID, {
      ideas: [ENVIRONMENT, STREAKS],
    });
    expect(screen.queryByRole('checkbox', { name: ENVIRONMENT })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: STREAKS })).not.toBeInTheDocument();
    expect(screen.getAllByText('Sent')).toHaveLength(2);
    expect(tick(HABIT)).toHaveAttribute('aria-checked', 'false');
    expect(tick(IDENTITY)).toHaveAttribute('aria-checked', 'false');
  });

  it('Send all sends every unsent bullet whatever is ticked, and clears the ticks', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(post(IDEAS));
    renderList([HABIT]);

    await user.click(tick(STREAKS));
    await user.click(screen.getByRole('button', { name: 'Send all to wiki' }));

    expect(await screen.findByText('All sent to wiki')).toBeInTheDocument();
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(1);
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledWith(POST_ID, {
      ideas: [ENVIRONMENT, STREAKS, IDENTITY],
    });
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('disables every tick box, Send all and Clear while a send is in flight', async () => {
    const user = userEvent.setup();
    const sending = deferred<ReaderPostListItem>();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(sending.promise);
    renderList();
    await user.click(tick(ENVIRONMENT));

    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send all to wiki/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    const pressed = screen.getByRole('button', { name: 'Sending…' });
    expect(pressed).toBeDisabled();
    expect(within(pressed).getByRole('status', { hidden: true })).toBeInTheDocument();

    // A second press cannot start a second send.
    await user.click(pressed);
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(1);

    sending.resolve(post([ENVIRONMENT]));
    expect(await screen.findByText('Sent')).toBeInTheDocument();
  });

  it('says Sending… on Send all while it is the send in flight', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(new Promise(() => {}));
    renderList();

    await user.click(screen.getByRole('button', { name: 'Send all to wiki' }));

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  });

  it('keeps the ticks exactly as they were when the send fails, and toasts', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockRejectedValue(
      new api.ApiError('API POST failed: 503', 503, 'The wiki repo was busy — try again'),
    );
    renderList();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(IDENTITY));

    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    expect(await screen.findByText('The wiki repo was busy — try again')).toBeInTheDocument();
    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'true');
    expect(tick(IDENTITY)).toHaveAttribute('aria-checked', 'true');
    expect(tick(HABIT)).toHaveAttribute('aria-checked', 'false');
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to wiki' })).toBeEnabled();
    expect(tick(ENVIRONMENT)).toBeEnabled();
  });
});

describe('NovelIdeaList — all sent', () => {
  it('replaces Send all with a muted "All sent to wiki", and offers nothing to tick', () => {
    renderList(IDEAS);

    expect(screen.getByText('All sent to wiki')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sent')).toHaveLength(IDEAS.length);
  });
});

describe('NovelIdeaList — what it looks like', () => {
  it('draws an empty tick box in the Inbox select-mode classes', () => {
    renderList();

    const box = within(tick(ENVIRONMENT)).getByTestId('novel-idea-tick');
    expect(box).toHaveClass('h-6', 'w-6', 'md:h-4', 'md:w-4', 'border-muted-foreground/50');
    expect(box).not.toHaveClass('bg-accent-teal');
    expect(within(tick(ENVIRONMENT)).queryByTestId('novel-idea-tick-check')).toBeNull();
  });

  it('fills a ticked box teal with a 10px check', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(tick(ENVIRONMENT));

    const box = within(tick(ENVIRONMENT)).getByTestId('novel-idea-tick');
    expect(box).toHaveClass('h-6', 'w-6', 'border-accent-teal', 'bg-accent-teal');
    expect(box).not.toHaveClass('border-muted-foreground/50');
    const check = within(tick(ENVIRONMENT)).getByTestId('novel-idea-tick-check');
    expect(check).toHaveAttribute('width', '10');
    expect(check).toHaveAttribute('height', '10');
  });

  it('dims only the tick box while a send is in flight, never the bullet text', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(new Promise(() => {}));
    renderList();
    expect(within(tick(HABIT)).getByTestId('novel-idea-tick')).not.toHaveClass('opacity-50');

    await user.click(screen.getByRole('button', { name: 'Send all to wiki' }));

    expect(tick(HABIT)).toHaveClass('disabled:opacity-100');
    expect(within(tick(HABIT)).getByTestId('novel-idea-tick')).toHaveClass('opacity-50');
  });

  it('marks a sent bullet with violet checks and a small muted "Sent"', () => {
    renderList([HABIT]);

    expect(screen.getByTestId('novel-idea-sent-mark')).toHaveClass('text-accent-violet');
    expect(screen.getByTestId('novel-idea-sent-check')).toHaveClass('text-accent-violet');
    expect(screen.getByText('Sent')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('wears violet on Send all’s glyph and on the "All sent" check', () => {
    const { unmount } = renderList();
    expect(screen.getByTestId('novel-ideas-send-all-glyph')).toHaveClass('text-accent-violet');
    unmount();

    renderList(IDEAS);
    expect(screen.getByTestId('novel-ideas-all-sent-check')).toHaveClass('text-accent-violet');
    expect(screen.getByText('All sent to wiki')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('draws the bar with the bulk bar’s teal counter, an accent send and a ghost Clear', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(tick(ENVIRONMENT));

    expect(screen.getByText('1 selected')).toHaveClass(
      'text-sm',
      'font-semibold',
      'text-accent-teal',
    );
    expect(screen.getByRole('button', { name: 'Send to wiki' })).toHaveClass('bg-accent-teal');
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toHaveClass('hover:bg-secondary');
    expect(clear).not.toHaveClass('bg-accent-teal');
  });

  it('keeps the bar mounted and collapsed while nothing is ticked, and opens it at one tick', async () => {
    const user = userEvent.setup();
    renderList();

    const collapse = screen.getByTestId('novel-ideas-selection');
    expect(collapse).toHaveClass('grid-rows-[0fr]');
    expect(collapse).toHaveAttribute('aria-hidden', 'true');

    await user.click(tick(ENVIRONMENT));

    expect(screen.getByTestId('novel-ideas-selection')).toHaveClass('grid-rows-[1fr]');
    expect(screen.getByTestId('novel-ideas-selection')).not.toHaveAttribute('aria-hidden', 'true');
  });
});

describe('NovelIdeaList — after a send lands', () => {
  it('clears every tick, even one the server did not mark sent', async () => {
    const user = userEvent.setup();
    // The server marked only one of the two — the other tick must still not survive the send.
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(post([ENVIRONMENT]));
    renderList();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(STREAKS));

    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(tick(STREAKS)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('moves focus to the next bullet still to tick when the bar folds away', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(post([HABIT, ENVIRONMENT]));
    renderList();
    await user.click(tick(HABIT));
    await user.click(tick(ENVIRONMENT));

    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    await waitFor(() => {
      expect(tick(STREAKS)).toHaveFocus();
    });
  });

  it('moves focus to the heading row when Send all leaves nothing to send', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(post(IDEAS));
    renderList();

    await user.click(screen.getByRole('button', { name: 'Send all to wiki' }));

    expect(await screen.findByText('All sent to wiki')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('novel-ideas-heading-row')).toHaveFocus();
    });
  });

  it('leaves focus alone when the owner moved it outside the list mid-send', async () => {
    const user = userEvent.setup();
    const sending = deferred<ReaderPostListItem>();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(sending.promise);
    renderReader(
      <>
        <LiveList />
        <label>
          Search
          <input />
        </label>
      </>,
      [post()],
      undefined,
      { wikiWritable: true },
    );
    await user.click(tick(HABIT));
    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    const search = screen.getByRole('textbox', { name: 'Search' });
    await user.click(search);
    sending.resolve(post([HABIT]));

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(queryBar()).not.toBeInTheDocument();
    expect(search).toHaveFocus();
  });

  it('gives the heading row a visible keyboard focus ring', () => {
    renderList();

    expect(screen.getByTestId('novel-ideas-heading-row')).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
    );
  });

  it('leaves focus on Send all when it is still there to press', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(post([HABIT]));
    renderList();

    await user.click(screen.getByRole('button', { name: 'Send all to wiki' }));

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send all to wiki' })).toHaveFocus();
  });
});
