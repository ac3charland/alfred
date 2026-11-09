import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import {
  makeReaderCandidate,
  makeReaderFeed,
  makeReaderPublicationListItem,
} from '@/lib/reader/fixtures';
import { renderWithProviders } from '@/lib/test-utils';
import type { ReaderPublication, ReaderPublicationListItem } from '@/lib/types';

import { PublicationsView } from './publications-view';

// The card and candidate row both write through the store, which calls the API client — mocked
// the same way the store's own test mocks it, so a click here never reaches a real request.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  createReaderPublication: jest.fn(),
  updateReaderPublication: jest.fn(),
}));

const NOW = new Date('2026-09-18T12:00:00.000Z');

/** A promise the test settles by hand, so a request can be held in flight. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('PublicationsView', () => {
  it('renders a roster card with its name, handle, provenance chip, last post and note', () => {
    const publication = makeReaderPublicationListItem('Second Thoughts', {
      handle: 'secondthoughts@substack.com',
      source: 'auto',
      notes: 'why this one',
      last_post_at: '2026-09-16T00:00:00.000Z',
    });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByText('Second Thoughts')).toBeInTheDocument();
    expect(screen.getByText(/secondthoughts@substack\.com/)).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText(/last post Sep 16/)).toBeInTheDocument();
    expect(screen.getByText('why this one')).toBeInTheDocument();
  });

  it('says a publication with no post has no posts yet', () => {
    const publication = makeReaderPublicationListItem('Fresh', { last_post_at: null });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByText(/no posts yet/)).toBeInTheDocument();
  });

  it('dims a paused card', () => {
    const publication = makeReaderPublicationListItem('Quiet', { enabled: false });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByRole('listitem')).toHaveClass('opacity-55');
    expect(screen.getByRole('button', { name: 'Paused' })).toBeInTheDocument();
  });

  it('gives the toggle button itself a title explaining what pausing and resuming do', () => {
    const publication = makeReaderPublicationListItem('Second Thoughts');
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByRole('button', { name: 'Enabled' })).toHaveAttribute(
      'title',
      'Paused publications are not claimed; posts already here stay. Re-enabling claims only mail from the last seven days.',
    );
  });

  it('counts enabled and paused publications', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [
          makeReaderPublicationListItem('A', { enabled: true }),
          makeReaderPublicationListItem('B', { enabled: false }),
          makeReaderPublicationListItem('C', { enabled: false }),
        ],
      },
    });

    expect(screen.getByText('1 enabled · 2 paused')).toBeInTheDocument();
  });

  it('disables the copy button with a reason when nothing is enabled', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('A', { enabled: false })] },
    });

    const button = screen.getByRole('button', { name: /copy gmail filter query/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Nothing to copy — no publication is enabled');
  });

  it('also renders the reason as visible text, since a disabled button’s title is unreachable', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('A', { enabled: false })] },
    });

    expect(screen.getByText(/nothing to copy: no publication is enabled/)).toBeInTheDocument();
  });

  it('does not render the reason when at least one publication is enabled', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('A', { enabled: true })] },
    });

    expect(screen.queryByText(/nothing to copy/)).not.toBeInTheDocument();
  });

  it('enables the copy button when at least one publication is enabled', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('A', { enabled: true })] },
    });

    expect(screen.getByRole('button', { name: /copy gmail filter query/i })).toBeEnabled();
  });

  it('shows the empty roster state when there are no publications', () => {
    renderWithProviders(<PublicationsView now={NOW} />, { readerSettings: { publications: [] } });

    expect(screen.getByText('No publications yet.')).toBeInTheDocument();
  });

  it('shows the empty candidates state when there are none', () => {
    renderWithProviders(<PublicationsView now={NOW} />, { readerSettings: { candidates: [] } });

    expect(screen.getByText('No candidates.')).toBeInTheDocument();
  });

  it('renders a candidate with its name, handle, count, and last-seen date', () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', {
      name: "Ben's Bites",
      message_count: 9,
      last_seen_at: '2026-09-17T00:00:00.000Z',
    });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    expect(screen.getByText("Ben's Bites")).toBeInTheDocument();
    expect(screen.getByText('hello@bensbites.beehiiv.com')).toBeInTheDocument();
    expect(screen.getByText(/9 messages · last Sep 17/)).toBeInTheDocument();
  });

  it('singularises the message count for a candidate seen once', () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { message_count: 1 });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    expect(screen.getByText(/1 message ·/)).toBeInTheDocument();
  });

  it('falls back to the handle when a candidate has no display name', () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { name: null });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    expect(screen.getAllByText('hello@bensbites.beehiiv.com').length).toBeGreaterThan(0);
  });

  it('promotes a candidate on Add', async () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { name: "Ben's Bites" });
    const mockCreate = jest.mocked(apiClient.createReaderPublication);
    mockCreate.mockResolvedValue({
      id: 'new-id',
      handle: candidate.handle,
      name: "Ben's Bites",
      domain: 'bensbites.beehiiv.com',
      enabled: true,
      source: 'owner',
      notes: null,
      summary_kind: 'alerts',
      feed_url: null,
      feed_etag: null,
      feed_last_modified: null,
      feed_checked_at: null,
      feed_last_success_at: null,
      feed_last_error: null,
      feed_last_error_at: null,
      first_seen_at: '2026-09-17T00:00:00.000Z',
      created_at: '2026-09-17T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    await user.click(screen.getByRole('button', { name: /add ben's bites as/i }));
    await user.click(screen.getByRole('menuitem', { name: /alerts/i }));

    // Promoted with the name the candidate row showed, so the roster card reads the same, and
    // with the kind picked, so its first summary already asks the right question.
    expect(mockCreate).toHaveBeenCalledWith({
      handle: candidate.handle,
      name: "Ben's Bites",
      summary_kind: 'alerts',
    });
    await screen.findByText('No candidates.');
    expect(screen.getByText("Ben's Bites")).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "Summary type for Ben's Bites: Alerts" }),
    ).toBeInTheDocument();
  });

  it('offers every kind, each with what it asks, on a candidate’s Add as', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [makeReaderCandidate('store-news@amazon.com')] },
    });

    await user.click(screen.getByRole('button', { name: /add store-news@amazon\.com as/i }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'EssayWhat’s new, the evidence, the argument',
      'RoundupHighlights, and the links worth reading',
      'AlertsOnly sales, security, actions, changes — else archived',
    ]);
  });

  it('shows each card’s kind on its chip, Essay by default', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [
          makeReaderPublicationListItem('Import AI', { summary_kind: 'roundup' }),
          makeReaderPublicationListItem('Second Thoughts'),
        ],
      },
    });

    expect(
      screen.getByRole('button', { name: 'Summary type for Import AI: Roundup' }),
    ).toHaveTextContent('Roundup');
    expect(
      screen.getByRole('button', { name: 'Summary type for Second Thoughts: Essay' }),
    ).toHaveTextContent('Essay');
  });

  it('changes a card’s kind in one pick, before the write settles', async () => {
    const publication = makeReaderPublicationListItem('Import AI', { id: 'pub-1' });
    const mockUpdate = jest.mocked(apiClient.updateReaderPublication);
    const updated = deferred<ReaderPublication>();
    mockUpdate.mockReturnValue(updated.promise);
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    await user.click(screen.getByRole('button', { name: 'Summary type for Import AI: Essay' }));
    await user.click(screen.getByRole('button', { name: /^Roundup/ }));

    expect(mockUpdate).toHaveBeenCalledWith('pub-1', { summary_kind: 'roundup' });
    expect(
      screen.getByRole('button', { name: 'Summary type for Import AI: Roundup' }),
    ).toBeInTheDocument();
    await act(async () => {
      updated.settle({ ...publication, summary_kind: 'roundup' });
      await updated.promise;
    });
  });

  it('rolls a card’s kind back when the write fails', async () => {
    const publication = makeReaderPublicationListItem('Import AI', { id: 'pub-1' });
    jest.mocked(apiClient.updateReaderPublication).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    await user.click(screen.getByRole('button', { name: 'Summary type for Import AI: Essay' }));
    await user.click(screen.getByRole('button', { name: /^Alerts/ }));

    expect(
      await screen.findByRole('button', { name: 'Summary type for Import AI: Essay' }),
    ).toBeInTheDocument();
  });

  it('writes nothing when the kind it already has is picked', async () => {
    const mockUpdate = jest.mocked(apiClient.updateReaderPublication);
    mockUpdate.mockClear();
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('Import AI')] },
    });

    await user.click(screen.getByRole('button', { name: 'Summary type for Import AI: Essay' }));
    await user.click(screen.getByRole('button', { name: /^Essay/ }));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('disables Add for a handle while its promotion is still in flight', async () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { name: "Ben's Bites" });
    const mockCreate = jest.mocked(apiClient.createReaderPublication);
    const created = deferred<ReaderPublication>();
    mockCreate.mockReturnValue(created.promise);
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    const button = screen.getByRole('button', { name: /add ben's bites as/i });
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: /essay/i }));

    expect(button).toBeDisabled();

    created.settle({
      id: 'new-id',
      handle: candidate.handle,
      name: "Ben's Bites",
      domain: 'bensbites.beehiiv.com',
      enabled: true,
      source: 'owner',
      notes: null,
      summary_kind: 'essay',
      feed_url: null,
      feed_etag: null,
      feed_last_modified: null,
      feed_checked_at: null,
      feed_last_success_at: null,
      feed_last_error: null,
      feed_last_error_at: null,
      first_seen_at: '2026-09-17T00:00:00.000Z',
      created_at: '2026-09-17T00:00:00.000Z',
    });
    await screen.findByText('No candidates.');
  });
});

describe('PublicationsView — feeds', () => {
  const FEED_URL = 'https://mlarson.org/feed.xml';

  function feedItem(overrides: Partial<ReaderPublicationListItem> = {}): ReaderPublicationListItem {
    return {
      ...makeReaderFeed('mlarson.org', FEED_URL, overrides),
      last_post_at: null,
      ...overrides,
    };
  }

  it('describes the roster as taking blogs by their feed URL', () => {
    renderWithProviders(<PublicationsView now={NOW} />);

    expect(
      screen.getByText(
        'Who the Reader summarises. Substack is added automatically, blogs by their feed URL, and anyone else you promote from the candidates below.',
      ),
    ).toBeInTheDocument();
  });

  it('mentions feeds in the empty roster state', () => {
    renderWithProviders(<PublicationsView now={NOW} />, { readerSettings: { publications: [] } });

    expect(screen.getByText(/add a blog by its feed URL above/)).toBeInTheDocument();
  });

  it('renders a feed’s card with the feed chip, its URL, last post and last check', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [
          feedItem({
            last_post_at: '2026-09-16T00:00:00.000Z',
            feed_checked_at: '2026-09-18T11:48:00.000Z',
          }),
        ],
      },
    });

    expect(screen.getByText('feed')).toBeInTheDocument();
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
    expect(
      screen.getByText(`${FEED_URL} · last post Sep 16 · checked 12m ago`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /summary type for mlarson\.org: essay/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enabled' })).toHaveAttribute(
      'title',
      "Paused feeds aren't polled; posts already here stay. Re-enabling takes posts from the last seven days.",
    );
  });

  it('shows the amber failure line on a failing feed', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [
          feedItem({
            feed_last_success_at: '2026-09-18T09:00:00.000Z',
            feed_last_error: 'it answered 404',
            feed_last_error_at: '2026-09-18T11:00:00.000Z',
          }),
        ],
      },
    });

    const line = screen.getByText(
      "Couldn't read the feed: it answered 404. Failing since 3h ago; retried hourly.",
    );
    expect(line).toHaveClass('text-accent-amber');
  });

  it('drops the failure line once the feed reads again', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [
          feedItem({
            feed_last_success_at: '2026-09-18T11:30:00.000Z',
            feed_last_error: 'it answered 404',
            feed_last_error_at: '2026-09-18T11:00:00.000Z',
          }),
        ],
      },
    });

    expect(screen.queryByText(/Couldn't read the feed/)).not.toBeInTheDocument();
  });

  it('counts feeds with the senders, but disables the copy button when no sender is enabled', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [feedItem(), makeReaderPublicationListItem('A', { enabled: false })],
      },
    });

    expect(screen.getByText(/1 enabled · 1 paused/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /copy gmail filter query/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Nothing to copy — no publication is enabled');
  });

  it('pauses a feed like a sender', async () => {
    const user = userEvent.setup();
    const feed = feedItem();
    jest.mocked(apiClient.updateReaderPublication).mockResolvedValue({ ...feed, enabled: false });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [feed] },
    });

    await user.click(screen.getByRole('button', { name: 'Enabled' }));

    expect(apiClient.updateReaderPublication).toHaveBeenCalledWith(feed.id, { enabled: false });
    expect(await screen.findByRole('button', { name: 'Paused' })).toBeInTheDocument();
  });

  describe('Add a feed', () => {
    it('disables Add feed while the field is empty', () => {
      renderWithProviders(<PublicationsView now={NOW} />);

      expect(screen.getByRole('button', { name: 'Add feed' })).toBeDisabled();
    });

    it('adds a feed on Enter: pending while the URL is fetched, then the card, and the field clears', async () => {
      const user = userEvent.setup();
      const created = deferred<ReaderPublication>();
      jest.mocked(apiClient.createReaderPublication).mockReturnValue(created.promise);
      renderWithProviders(<PublicationsView now={NOW} />, {
        readerSettings: { publications: [makeReaderPublicationListItem('Zeta')] },
      });

      const field = screen.getByRole('textbox', { name: 'Feed URL' });
      await user.type(field, `${FEED_URL}{Enter}`);

      expect(apiClient.createReaderPublication).toHaveBeenCalledWith({ feed_url: FEED_URL });
      expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();

      await act(async () => {
        created.settle(makeReaderFeed('Mark Larson', FEED_URL));
        await created.promise;
      });

      expect(field).toHaveValue('');
      const names = screen.getAllByRole('listitem').map((item) => item.textContent);
      // Sorted by name, as the roster always is.
      expect(names[0]).toContain('Mark Larson');
      expect(names[1]).toContain('Zeta');
      expect(screen.getByText('feed')).toBeInTheDocument();
    });

    it.each([
      [
        'a page that isn’t a feed',
        new apiClient.ApiError('x', 422, 'not-a-feed', { error: 'not-a-feed' }),
        "That page isn't an RSS or Atom feed. Paste the feed's own URL, often ending in /feed.xml, /rss or /atom.xml.",
      ],
      [
        'an unreachable URL',
        new apiClient.ApiError('x', 422, 'unreachable', { error: 'unreachable', status: 503 }),
        "Couldn't reach that URL (503).",
      ],
      [
        'a duplicate',
        new apiClient.ApiError('x', 409, 'duplicate', { error: 'duplicate' }),
        'That feed is already on the roster.',
      ],
    ])('keeps the text and says why under the field for %s', async (_label, error, message) => {
      const user = userEvent.setup();
      jest.mocked(apiClient.createReaderPublication).mockRejectedValue(error);
      renderWithProviders(<PublicationsView now={NOW} />, {
        readerSettings: { publications: [] },
      });

      const field = screen.getByRole('textbox', { name: 'Feed URL' });
      await user.type(field, 'https://mlarson.org');
      await user.click(screen.getByRole('button', { name: 'Add feed' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(field).toHaveValue('https://mlarson.org');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryAllByRole('listitem')).toEqual([]);
    });
  });
});
