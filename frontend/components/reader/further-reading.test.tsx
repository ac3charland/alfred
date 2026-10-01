import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import { useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderFurtherReading, ReaderPostListItem } from '@/lib/types';

import { FurtherReading } from './further-reading';
import { renderReader } from './test-helpers';

// A partial mock: the send is stubbed, but `ApiError` stays the real class, since the store
// quotes the route's own sentence from it.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  sendReaderFurtherReading: jest.fn(),
}));
const mockApi = jest.mocked(api);

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const ALPHA: ReaderFurtherReading = {
  url: 'https://example.com/a',
  title: 'Alpha piece',
  note: 'The primary source.',
};
const BETA: ReaderFurtherReading = {
  url: 'https://example.com/b',
  title: 'Beta piece',
  note: 'The rebuttal.',
};
const GAMMA: ReaderFurtherReading = {
  url: 'https://example.com/c',
  title: 'Gamma piece',
  note: 'The background.',
};
const ITEMS: ReaderFurtherReading[] = [ALPHA, BETA, GAMMA];
const A = ALPHA.url;
const B = BETA.url;
const C = GAMMA.url;

/** A promise the test settles by hand, so one send can be held in flight. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function post(sentReader: string[] = [], sentInstapaper: string[] = []): ReaderPostListItem {
  const { text: _text, ...row } = makeReaderPost(PUBLICATION_ID, {
    id: POST_ID,
    summary_state: 'done',
    further_sent_reader: sentReader,
    further_sent_instapaper: sentInstapaper,
  });
  return row;
}

/** The checklist as the overview mounts it: fed from the store, so a reconciled send redraws it. */
function Live({ items = ITEMS }: { items?: ReaderFurtherReading[] }) {
  const row = useReaderPosts().find((candidate) => candidate.id === POST_ID);
  if (row === undefined) return null;
  return (
    <FurtherReading
      postId={row.id}
      items={items}
      sentReader={row.further_sent_reader}
      sentInstapaper={row.further_sent_instapaper}
    />
  );
}

function renderLive(
  row: ReaderPostListItem = post(),
  { instapaperConfigured = true, wikiWritable = false } = {},
) {
  return renderReader(<Live />, [row], undefined, { instapaperConfigured, wikiWritable });
}

function tick(title: string): HTMLElement {
  return screen.getByRole('checkbox', { name: new RegExp(title) });
}

beforeEach(() => {
  resetReaderFixtureClock();
  mockApi.sendReaderFurtherReading.mockReset();
});

describe('FurtherReading — checklist', () => {
  it('draws the heading, every item with its note, and no bar until something is ticked', () => {
    renderLive();

    expect(screen.getByRole('heading', { name: 'Further reading' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('The rebuttal.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Selected links', hidden: true })).toBeInTheDocument();
    expect(screen.getByTestId('further-reading-selection')).toBeInTheDocument();
  });

  it('ticks and unticks an item, drawing the check', async () => {
    const user = userEvent.setup();
    renderLive();

    await user.click(tick('Alpha'));
    expect(tick('Alpha')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByTestId('further-reading-tick-check')).toHaveLength(1);
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(tick('Alpha'));
    expect(tick('Alpha')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('further-reading-tick-check')).not.toBeInTheDocument();
  });

  it('toggles on Space and does nothing on Enter', async () => {
    const user = userEvent.setup();
    renderLive();

    tick('Beta').focus();
    await user.keyboard('{Enter}');
    expect(tick('Beta')).toHaveAttribute('aria-checked', 'false');
    await user.keyboard(' ');
    expect(tick('Beta')).toHaveAttribute('aria-checked', 'true');
  });

  it('Select all ticks only the unsent items, and Deselect all clears them', async () => {
    const user = userEvent.setup();
    renderLive(post([A]));

    await user.click(screen.getByRole('button', { name: 'Select all Further reading' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deselect all Further reading' }));
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('sends the ticked urls to the Reader in overview order, then clears and folds the bar', async () => {
    const user = userEvent.setup();
    const sent = post([A, C]);
    mockApi.sendReaderFurtherReading.mockResolvedValue({ post: sent, landed: [], unsent: [] });
    renderLive();

    await user.click(tick('Gamma'));
    await user.click(tick('Alpha'));
    await user.click(screen.getByRole('button', { name: 'Send to Reader' }));

    expect(mockApi.sendReaderFurtherReading).toHaveBeenCalledWith(POST_ID, {
      destination: 'reader',
      urls: [A, C],
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('further-reading-in-reader')).toHaveLength(2);
    });
    expect(screen.getByTestId('further-reading-selection')).toHaveAttribute('inert');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(tick('Beta')).toHaveAttribute('aria-checked', 'false');
  });

  it('sends to Instapaper with its own destination', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockResolvedValue({
      post: post([], [B]),
      landed: [],
      unsent: [],
    });
    renderLive();

    await user.click(tick('Beta'));
    await user.click(screen.getByRole('button', { name: 'Send to Instapaper' }));

    expect(mockApi.sendReaderFurtherReading).toHaveBeenCalledWith(POST_ID, {
      destination: 'instapaper',
      urls: [B],
    });
    expect(await screen.findByTestId('further-reading-in-instapaper')).toHaveTextContent(
      'In Instapaper',
    );
  });

  it('disables every control and reads Sending… on the pressed button while pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<api.SendFurtherReadingResult>();
    mockApi.sendReaderFurtherReading.mockReturnValue(pending.promise);
    renderLive();

    await user.click(tick('Alpha'));
    await user.click(screen.getByRole('button', { name: 'Send to Instapaper' }));

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send to Reader' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Further reading' })).toBeDisabled();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();

    await act(async () => {
      pending.settle({ post: post([], [A]), landed: [], unsent: [] });
      await pending.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select all Further reading' })).toBeEnabled();
    });
  });

  it('marks sent items, In Reader in green and In Instapaper muted, and a url in both reads In Reader', () => {
    renderLive(post([A, B], [B, C]));

    const reader = screen.getAllByTestId('further-reading-in-reader');
    expect(reader).toHaveLength(2);
    for (const mark of reader) expect(mark).toHaveClass('text-accent-green');
    expect(screen.getAllByTestId('further-reading-in-instapaper')).toHaveLength(1);
    expect(screen.getAllByTestId('further-reading-sent-mark')).toHaveLength(3);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows All sent in place of Select all when nothing is left to pick, and the links still open', () => {
    renderLive(post([A, B], [C]));

    expect(screen.getByText('All sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Gamma piece' })).toHaveAttribute('href', C);
  });

  it('keeps the unsent url ticked after a partial send, and toasts', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockResolvedValue({
      post: post([A]),
      landed: [A],
      unsent: [B],
      failure: "Instapaper didn't answer",
    });
    renderLive();

    await user.click(tick('Alpha'));
    await user.click(tick('Beta'));
    await user.click(screen.getByRole('button', { name: 'Send to Reader' }));

    expect(await screen.findByText(/Sent 1 of 2 to Reader/)).toBeInTheDocument();
    expect(await screen.findByTestId('further-reading-in-reader')).toBeInTheDocument();
    expect(tick('Beta')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('keeps every tick and toasts the route’s sentence when the send throws', async () => {
    const user = userEvent.setup();
    mockApi.sendReaderFurtherReading.mockRejectedValue(
      new api.ApiError('API POST failed: 502', 502, "Instapaper didn't answer — try again"),
    );
    renderLive();

    await user.click(tick('Alpha'));
    await user.click(tick('Beta'));
    await user.click(screen.getByRole('button', { name: 'Send to Reader' }));

    expect(await screen.findByText("Instapaper didn't answer — try again")).toBeInTheDocument();
    expect(tick('Alpha')).toHaveAttribute('aria-checked', 'true');
    expect(tick('Beta')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Send to Reader' })).toBeEnabled();
  });

  it('opens each article from a sibling link, never one nested in the checkbox', () => {
    renderLive();

    const link = screen.getByRole('link', { name: 'Open Alpha piece' });
    expect(link).toHaveAttribute('href', A);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(tick('Alpha').contains(link)).toBe(false);
    expect(link.closest('li')).toBe(tick('Alpha').closest('li'));
  });

  it('draws a repeated url once, the first item winning', () => {
    renderReader(
      <FurtherReading
        postId={POST_ID}
        items={[ALPHA, { ...ALPHA, title: 'Dupe' }]}
        sentReader={[]}
        sentInstapaper={[]}
      />,
      [post()],
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByText('Dupe')).not.toBeInTheDocument();
  });
});

describe('FurtherReading — Instapaper not configured', () => {
  it.each([false, true])(
    'is a plain list of links with the note after, no ticks and no bar (wiki writable: %s)',
    (wikiWritable) => {
      renderLive(post(), { instapaperConfigured: false, wikiWritable });

      expect(screen.getByRole('heading', { name: 'Further reading' })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('further-reading-selection')).not.toBeInTheDocument();
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(3);
      const [first] = items;
      if (first === undefined) throw new Error('no list item');
      const link = within(first).getByRole('link', { name: 'Alpha piece' });
      expect(link).toHaveAttribute('href', A);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(first).toHaveTextContent('Alpha piece — The primary source.');
    },
  );

  it('omits the dash when the note is blank', () => {
    renderReader(
      <FurtherReading
        postId={POST_ID}
        items={[{ url: A, title: 'Alpha piece', note: '  ' }]}
        sentReader={[]}
        sentInstapaper={[]}
      />,
      [post()],
      undefined,
      { instapaperConfigured: false },
    );

    expect(screen.getByRole('listitem')).toHaveTextContent(/^Alpha piece$/);
  });
});
