import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderOverview, makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import { useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderPostListItem } from '@/lib/types';

import { renderReader } from './test-helpers';
import { WikiPicks } from './wiki-picks';

// A partial mock: the send is stubbed, but `ApiError` stays the real class, since the store
// quotes the route's own sentence from it.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  sendReaderPicksToWiki: jest.fn(),
}));
const mockApi = jest.mocked(api);

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const HABIT = 'Habit stacking works because the cue is an existing routine, not a time of day.';
const ENVIRONMENT = 'Environment design beats willpower for the first thirty days.';
const STREAKS = 'Streak-tracking helps only until the first miss.';
const IDENTITY = 'Identity-based framing outlasts outcome goals.';
const IDEAS = [HABIT, ENVIRONMENT, STREAKS, IDENTITY];

const LALLY = 'Lally et al. (2010): median 66 days to automaticity, ranging from 18 to 254.';
const SURVEY = 'A survey of 2,000 habit-app users: streak users lapsed 40% more often.';
const LOG = "The author's own 90-day log, n=1, flagged as such.";
const EVIDENCE = [LALLY, SURVEY, LOG];

const EMPTY_IDEAS = 'Nothing new — the post restates what a well-read reader already knows.';
const EMPTY_EVIDENCE = 'None — the post rests on assertion alone.';

interface Sent {
  ideas?: string[];
  evidence?: string[];
}

function post({ ideas = [], evidence = [] }: Sent = {}): ReaderPostListItem {
  const { text: _text, ...row } = makeReaderPost(PUBLICATION_ID, {
    id: POST_ID,
    summary_state: 'done',
    overview: makeReaderOverview({ novel_ideas: IDEAS, evidence: EVIDENCE }),
    wiki_sent_ideas: ideas,
    wiki_sent_evidence: evidence,
  });
  return row;
}

interface Bullets {
  ideas?: readonly string[];
  evidence?: readonly string[];
}

/** The checklist as the overview mounts it: fed from the store, so a reconciled send redraws it. */
function LivePicks({ ideas = IDEAS, evidence = EVIDENCE }: Bullets) {
  const row = useReaderPosts().find((candidate) => candidate.id === POST_ID);
  if (row === undefined) return null;
  return (
    <WikiPicks
      postId={row.id}
      ideas={{
        heading: 'Novel ideas',
        bullets: ideas,
        sent: row.wiki_sent_ideas,
        empty: <p>{EMPTY_IDEAS}</p>,
      }}
      evidence={{
        heading: 'Evidence',
        bullets: evidence,
        sent: row.wiki_sent_evidence,
        empty: <p>{EMPTY_EVIDENCE}</p>,
      }}
    />
  );
}

function renderPicks(sent: Sent = {}, bullets: Bullets = {}) {
  return renderReader(<LivePicks {...bullets} />, [post(sent)], undefined, {
    wikiWritable: true,
  });
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

function tick(bullet: string): HTMLElement {
  return screen.getByRole('checkbox', { name: bullet });
}

/** The selection bar, which must be showing. */
function bar(): HTMLElement {
  return screen.getByRole('group', { name: 'Selected bullets' });
}

/** The selection bar, if it is showing — folded away, it leaves the accessibility tree. */
function queryBar(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Selected bullets' });
}

function section(heading: string): HTMLElement {
  const title = screen.getByRole('heading', { level: 3, name: heading });
  const found = title.closest('section');
  if (found === null) throw new Error(`no section for ${heading}`);
  return found;
}

function sendButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Send to wiki' });
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('WikiPicks — ticking', () => {
  it('draws every unsent bullet in both sections as an unticked checkbox', () => {
    renderPicks();

    for (const bullet of [...IDEAS, ...EVIDENCE]) {
      expect(tick(bullet)).toHaveAttribute('aria-checked', 'false');
    }
    expect(within(section('Evidence')).getAllByRole('checkbox')).toHaveLength(EVIDENCE.length);
  });

  it('ticks and unticks a bullet in either section by a click anywhere on its row', async () => {
    const user = userEvent.setup();
    renderPicks();

    await user.click(screen.getByText(ENVIRONMENT));
    await user.click(screen.getByText(SURVEY));
    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'true');
    expect(tick(SURVEY)).toHaveAttribute('aria-checked', 'true');

    await user.click(tick(SURVEY));
    expect(tick(SURVEY)).toHaveAttribute('aria-checked', 'false');
  });

  it('ticks a focused evidence bullet with Space, and never with Enter', async () => {
    const user = userEvent.setup();
    renderPicks();

    tick(LOG).focus();
    await user.keyboard('{Enter}');
    expect(tick(LOG)).toHaveAttribute('aria-checked', 'false');

    await user.keyboard(' ');
    expect(tick(LOG)).toHaveAttribute('aria-checked', 'true');
  });

  it('draws a sent bullet in either section as sent, and never as something to tick', async () => {
    const user = userEvent.setup();
    renderPicks({ ideas: [HABIT], evidence: [LALLY] });

    expect(screen.queryByRole('checkbox', { name: HABIT })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: LALLY })).not.toBeInTheDocument();
    expect(screen.getAllByText('Sent')).toHaveLength(2);

    await user.click(screen.getByText(LALLY));
    expect(queryBar()).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  });

  it('keeps an idea and an evidence bullet with the same text apart', async () => {
    const user = userEvent.setup();
    const shared = 'Two independent replications agree.';
    renderPicks({ ideas: [shared] }, { ideas: [shared, HABIT], evidence: [shared] });

    // The idea is sent; the evidence bullet with its text is not.
    expect(within(section('Novel ideas')).getByText('Sent')).toBeInTheDocument();
    const evidenceTick = within(section('Evidence')).getByRole('checkbox', { name: shared });
    await user.click(evidenceTick);
    await user.click(tick(HABIT));

    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });
});

describe('WikiPicks — blank bullets', () => {
  it('drops empty and whitespace-only bullets in both sections: they never reach a send', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockResolvedValue(post({ ideas: [HABIT], evidence: [LALLY] }));
    renderPicks({}, { ideas: ['', HABIT, '   \t'], evidence: [' ', LALLY, '\n'] });

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Select all Novel ideas' }));
    await user.click(screen.getByRole('button', { name: 'Select all Evidence' }));
    await user.click(sendButton());

    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledWith(POST_ID, {
      ideas: [HABIT],
      evidence: [LALLY],
    });
  });
});

describe('WikiPicks — one section a checklist', () => {
  it('draws Evidence alone as a checklist when there are no novel ideas, with the bar under it', async () => {
    const user = userEvent.setup();
    renderPicks({}, { ideas: [] });

    const ideas = section('Novel ideas');
    expect(within(ideas).getByText(EMPTY_IDEAS)).toBeInTheDocument();
    expect(within(ideas).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();

    await user.click(tick(LOG));

    expect(within(section('Evidence')).getByRole('group', { name: 'Selected bullets' })).toBe(
      bar(),
    );
  });

  it('sends evidence alone from an evidence-only post', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockResolvedValue(post({ evidence: [LOG] }));
    renderPicks({}, { ideas: [] });

    await user.click(tick(LOG));
    await user.click(sendButton());

    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledWith(POST_ID, {
      ideas: [],
      evidence: [LOG],
    });
  });

  it('keeps the bar under Novel ideas when there is no evidence, and states the empty line', async () => {
    const user = userEvent.setup();
    renderPicks({}, { evidence: [] });

    const evidence = section('Evidence');
    expect(within(evidence).getByText(EMPTY_EVIDENCE)).toBeInTheDocument();
    expect(within(evidence).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-heading-row')).not.toBeInTheDocument();

    await user.click(tick(HABIT));

    expect(within(section('Novel ideas')).getByRole('group', { name: 'Selected bullets' })).toBe(
      bar(),
    );
  });
});

describe('WikiPicks — the selection bar', () => {
  it('stays folded away while nothing is ticked', () => {
    renderPicks();

    expect(queryBar()).not.toBeInTheDocument();
  });

  it('counts ticks from both sections in one bar, placed after the Evidence list', async () => {
    const user = userEvent.setup();
    renderPicks();

    await user.click(tick(ENVIRONMENT));
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
    await user.click(tick(SURVEY));
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();

    expect(screen.getAllByRole('group', { name: 'Selected bullets' })).toHaveLength(1);
    const evidence = section('Evidence');
    expect(within(evidence).getByRole('group', { name: 'Selected bullets' })).toBe(bar());
    const list = within(evidence).getByRole('list');
    expect(list.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(
      0,
    );
  });

  it('unticks both sections on Clear and folds away', async () => {
    const user = userEvent.setup();
    renderPicks();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(LALLY));

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'false');
    expect(tick(LALLY)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('spaces the counter and Clear evenly about Send to wiki: mr-2 on the counter, px-2 on Clear', async () => {
    const user = userEvent.setup();
    renderPicks();

    await user.click(tick(ENVIRONMENT));

    expect(within(bar()).getByText('1 selected')).toHaveClass('mr-2');
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toHaveClass('px-2');
    expect(clear).not.toHaveClass('px-3');
    expect(bar()).toHaveClass('gap-2');
  });
});

describe('WikiPicks — Select all', () => {
  it('gives the two Select all buttons distinct accessible names', () => {
    renderPicks();

    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toHaveTextContent(
      'Select all',
    );
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toHaveTextContent(
      'Select all',
    );
  });

  it('ticks every unsent bullet in its own section only, sends nothing, and leaves the other section alone', async () => {
    const user = userEvent.setup();
    renderPicks({ evidence: [LALLY] });
    await user.click(tick(STREAKS));

    await user.click(screen.getByRole('button', { name: 'Select all Evidence' }));

    expect(tick(SURVEY)).toHaveAttribute('aria-checked', 'true');
    expect(tick(LOG)).toHaveAttribute('aria-checked', 'true');
    expect(tick(STREAKS)).toHaveAttribute('aria-checked', 'true');
    expect(tick(HABIT)).toHaveAttribute('aria-checked', 'false');
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument();
    expect(mockApi.sendReaderPicksToWiki).not.toHaveBeenCalled();
  });

  it('reads Deselect all exactly when every unsent bullet in its section is ticked, however they got ticked', async () => {
    const user = userEvent.setup();
    renderPicks({ ideas: [HABIT, ENVIRONMENT, IDENTITY] });

    // One unsent idea left: ticking it by hand turns its section's button, not the other's.
    await user.click(tick(STREAKS));
    expect(screen.getByRole('button', { name: 'Deselect all Novel ideas' })).toHaveTextContent(
      'Deselect all',
    );
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeInTheDocument();

    await user.click(tick(LALLY));
    await user.click(tick(SURVEY));
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeInTheDocument();
    await user.click(tick(LOG));
    expect(screen.getByRole('button', { name: 'Deselect all Evidence' })).toBeInTheDocument();

    await user.click(tick(SURVEY));
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeInTheDocument();
  });

  it('unticks its own section only on Deselect all', async () => {
    const user = userEvent.setup();
    renderPicks();
    await user.click(tick(HABIT));
    await user.click(screen.getByRole('button', { name: 'Select all Evidence' }));

    await user.click(screen.getByRole('button', { name: 'Deselect all Evidence' }));

    for (const bullet of EVIDENCE) expect(tick(bullet)).toHaveAttribute('aria-checked', 'false');
    expect(tick(HABIT)).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeInTheDocument();
  });

  it('is a plain ghost button with no wiki glyph', () => {
    renderPicks();

    const selectAll = screen.getByRole('button', { name: 'Select all Novel ideas' });
    expect(selectAll).toHaveClass('hover:bg-secondary', 'h-8');
    expect(selectAll.querySelector('svg')).toBeNull();
  });
});

describe('WikiPicks — sending', () => {
  it('renders no Send all anywhere: Send to wiki is the only control that sends', async () => {
    const user = userEvent.setup();
    renderPicks();

    expect(screen.queryByRole('button', { name: /Send all/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all Novel ideas' }));
    await user.click(screen.getByRole('button', { name: 'Select all Evidence' }));
    await user.click(tick(HABIT));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mockApi.sendReaderPicksToWiki).not.toHaveBeenCalled();
  });

  it('sends the ticked bullets from both sections in one request, in overview order, then draws them sent', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockResolvedValue(
      post({ ideas: [ENVIRONMENT, STREAKS], evidence: [LALLY] }),
    );
    renderPicks();

    // Ticked out of overview order: the send still names them in the order the overview draws them.
    await user.click(tick(LALLY));
    await user.click(tick(STREAKS));
    await user.click(tick(ENVIRONMENT));
    await user.click(sendButton());

    await waitFor(() => {
      expect(queryBar()).not.toBeInTheDocument();
    });
    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledTimes(1);
    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledWith(POST_ID, {
      ideas: [ENVIRONMENT, STREAKS],
      evidence: [LALLY],
    });
    expect(screen.queryByRole('checkbox', { name: LALLY })).not.toBeInTheDocument();
    expect(screen.getAllByText('Sent')).toHaveLength(3);
    expect(tick(HABIT)).toHaveAttribute('aria-checked', 'false');
    expect(tick(SURVEY)).toHaveAttribute('aria-checked', 'false');
  });

  it('sends a whole post as Select all on each section, then one press of Send to wiki', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockResolvedValue(post({ ideas: IDEAS, evidence: EVIDENCE }));
    renderPicks({ ideas: [HABIT] });

    await user.click(screen.getByRole('button', { name: 'Select all Novel ideas' }));
    await user.click(screen.getByRole('button', { name: 'Select all Evidence' }));
    await user.click(sendButton());

    expect(await screen.findAllByText('All sent to wiki')).toHaveLength(2);
    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledTimes(1);
    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledWith(POST_ID, {
      ideas: [ENVIRONMENT, STREAKS, IDENTITY],
      evidence: EVIDENCE,
    });
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('disables every control in both sections while a send is in flight', async () => {
    const user = userEvent.setup();
    const sending = deferred<ReaderPostListItem>();
    mockApi.sendReaderPicksToWiki.mockReturnValue(sending.promise);
    renderPicks();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(LALLY));

    await user.click(sendButton());

    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    const pressed = screen.getByRole('button', { name: 'Sending…' });
    expect(pressed).toBeDisabled();
    expect(within(pressed).getByRole('status', { hidden: true })).toBeInTheDocument();

    // A second press cannot start a second send.
    await user.click(pressed);
    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledTimes(1);

    sending.resolve(post({ ideas: [ENVIRONMENT], evidence: [LALLY] }));
    expect(await screen.findAllByText('Sent')).toHaveLength(2);
  });

  it('keeps every tick in both sections exactly as it was when the send fails, and toasts', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockRejectedValue(
      new api.ApiError('API POST failed: 503', 503, 'The wiki repo was busy — try again'),
    );
    renderPicks();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(SURVEY));

    await user.click(sendButton());

    expect(await screen.findByText('The wiki repo was busy — try again')).toBeInTheDocument();
    expect(tick(ENVIRONMENT)).toHaveAttribute('aria-checked', 'true');
    expect(tick(SURVEY)).toHaveAttribute('aria-checked', 'true');
    expect(tick(HABIT)).toHaveAttribute('aria-checked', 'false');
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
    expect(tick(SURVEY)).toBeEnabled();
  });

  it('toasts the route’s own sentence for a stale evidence bullet', async () => {
    const user = userEvent.setup();
    const sentence = "That evidence isn't in this post's overview any more";
    mockApi.sendReaderPicksToWiki.mockRejectedValue(
      new api.ApiError('API POST failed: 409', 409, sentence),
    );
    renderPicks();
    await user.click(tick(LOG));

    await user.click(sendButton());

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(tick(LOG)).toHaveAttribute('aria-checked', 'true');
  });
});

describe('WikiPicks — all sent', () => {
  it('replaces a fully sent section’s Select all with "All sent to wiki", and leaves the other section’s', () => {
    renderPicks({ evidence: EVIDENCE });

    const evidence = section('Evidence');
    expect(within(evidence).getByText('All sent to wiki')).toBeInTheDocument();
    expect(within(evidence).queryByRole('button')).not.toBeInTheDocument();
    expect(within(evidence).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(evidence).getAllByText('Sent')).toHaveLength(EVIDENCE.length);
    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toBeInTheDocument();
  });

  it('offers nothing to tick once both sections are sent', () => {
    renderPicks({ ideas: IDEAS, evidence: EVIDENCE });

    expect(screen.getAllByText('All sent to wiki')).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('WikiPicks — what it looks like', () => {
  it('draws an empty evidence tick box in the Inbox select-mode classes', () => {
    renderPicks();

    const box = within(tick(SURVEY)).getByTestId('wiki-pick-tick');
    expect(box).toHaveClass('h-6', 'w-6', 'md:h-4', 'md:w-4', 'border-muted-foreground/50');
    expect(box).not.toHaveClass('bg-accent-teal');
    expect(within(tick(SURVEY)).queryByTestId('wiki-pick-tick-check')).toBeNull();
  });

  it('fills a ticked box teal with a 10px check', async () => {
    const user = userEvent.setup();
    renderPicks();

    await user.click(tick(SURVEY));

    const box = within(tick(SURVEY)).getByTestId('wiki-pick-tick');
    expect(box).toHaveClass('h-6', 'w-6', 'border-accent-teal', 'bg-accent-teal');
    expect(box).not.toHaveClass('border-muted-foreground/50');
    const check = within(tick(SURVEY)).getByTestId('wiki-pick-tick-check');
    expect(check).toHaveAttribute('width', '10');
    expect(check).toHaveAttribute('height', '10');
  });

  it('dims only the tick boxes while a send is in flight, never the bullet text', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockReturnValue(new Promise(() => {}));
    renderPicks();
    expect(within(tick(LOG)).getByTestId('wiki-pick-tick')).not.toHaveClass('opacity-50');
    await user.click(tick(HABIT));

    await user.click(sendButton());

    expect(tick(LOG)).toHaveClass('disabled:opacity-100');
    expect(within(tick(LOG)).getByTestId('wiki-pick-tick')).toHaveClass('opacity-50');
  });

  it('marks a sent evidence bullet exactly like a sent idea: violet checks and a small muted "Sent"', () => {
    renderPicks({ evidence: [LALLY] });

    const evidence = section('Evidence');
    expect(within(evidence).getByTestId('wiki-pick-sent-mark')).toHaveClass('text-accent-violet');
    expect(within(evidence).getByTestId('wiki-pick-sent-check')).toHaveClass('text-accent-violet');
    expect(within(evidence).getByText('Sent')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('wears violet on the "All sent" check', () => {
    renderPicks({ ideas: IDEAS });

    expect(screen.getByTestId('wiki-picks-all-sent-check')).toHaveClass('text-accent-violet');
    expect(screen.getByText('All sent to wiki')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('draws the bar with the bulk bar’s teal counter, an accent send and a ghost Clear', async () => {
    const user = userEvent.setup();
    renderPicks();

    await user.click(tick(ENVIRONMENT));

    expect(screen.getByText('1 selected')).toHaveClass(
      'text-sm',
      'font-semibold',
      'text-accent-teal',
    );
    expect(sendButton()).toHaveClass('bg-accent-teal');
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toHaveClass('hover:bg-secondary');
    expect(clear).not.toHaveClass('bg-accent-teal');
  });

  it('keeps the bar mounted and collapsed while nothing is ticked, and opens it at one tick', async () => {
    const user = userEvent.setup();
    renderPicks();

    const collapse = screen.getByTestId('wiki-picks-selection');
    expect(collapse).toHaveClass('grid-rows-[0fr]');
    expect(collapse).toHaveAttribute('aria-hidden', 'true');

    await user.click(tick(LALLY));

    expect(screen.getByTestId('wiki-picks-selection')).toHaveClass('grid-rows-[1fr]');
    expect(screen.getByTestId('wiki-picks-selection')).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each checklist section a 32px heading row with a visible keyboard focus ring', () => {
    renderPicks();

    for (const id of ['novel-ideas-heading-row', 'evidence-heading-row']) {
      expect(screen.getByTestId(id)).toHaveClass(
        'min-h-8',
        'focus-visible:ring-2',
        'focus-visible:ring-ring',
      );
    }
  });
});

describe('WikiPicks — reduced motion', () => {
  // The collapse reads no media query itself: CSS does the work, so what jsdom can pin is the
  // class that switches the height transition off, and that the count alone opens and folds it.
  it('marks the collapse motion-reduce:transition-none, and opens and folds it on the count', async () => {
    const user = userEvent.setup();
    renderPicks();

    const collapse = screen.getByTestId('wiki-picks-selection');
    expect(collapse).toHaveClass('motion-reduce:transition-none');

    await user.click(tick(LALLY));
    expect(collapse).toHaveClass('grid-rows-[1fr]');
    expect(bar()).toHaveTextContent('1 selected');

    await user.click(tick(LALLY));
    expect(collapse).toHaveClass('grid-rows-[0fr]');
    expect(queryBar()).not.toBeInTheDocument();
  });
});

describe('WikiPicks — after a send lands', () => {
  it('clears every tick, even one the server did not mark sent', async () => {
    const user = userEvent.setup();
    // The server marked only one of the two — the other tick must still not survive the send.
    mockApi.sendReaderPicksToWiki.mockResolvedValue(post({ ideas: [ENVIRONMENT] }));
    renderPicks();
    await user.click(tick(ENVIRONMENT));
    await user.click(tick(SURVEY));

    await user.click(sendButton());

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(tick(SURVEY)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('moves focus to the first unsent tick row across both sections when the bar folds away', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockResolvedValue(post({ ideas: IDEAS, evidence: [LALLY] }));
    renderPicks({ ideas: [HABIT, ENVIRONMENT] });
    await user.click(tick(STREAKS));
    await user.click(tick(IDENTITY));
    await user.click(tick(LALLY));

    await user.click(sendButton());

    await waitFor(() => {
      expect(tick(SURVEY)).toHaveFocus();
    });
  });

  it('moves focus to the first checklist section’s heading row when nothing is left to send', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderPicksToWiki.mockResolvedValue(post({ ideas: IDEAS, evidence: EVIDENCE }));
    renderPicks({ ideas: [HABIT, ENVIRONMENT, STREAKS], evidence: [LALLY, SURVEY] });
    await user.click(tick(IDENTITY));
    await user.click(tick(LOG));

    await user.click(sendButton());

    expect(await screen.findAllByText('All sent to wiki')).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByTestId('novel-ideas-heading-row')).toHaveFocus();
    });
  });

  it('leaves focus alone when the owner moved it outside the checklist mid-send', async () => {
    const user = userEvent.setup();
    const sending = deferred<ReaderPostListItem>();
    mockApi.sendReaderPicksToWiki.mockReturnValue(sending.promise);
    renderReader(
      <>
        <LivePicks />
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
    await user.click(sendButton());

    const search = screen.getByRole('textbox', { name: 'Search' });
    await user.click(search);
    sending.resolve(post({ ideas: [HABIT] }));

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(queryBar()).not.toBeInTheDocument();
    expect(search).toHaveFocus();
  });
});
