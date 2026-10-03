import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  type StoredReaderOverview,
  makeAlertsOverview,
  makeReaderArticle,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublicationListItem,
  makeResearchPost,
  makeRoundupOverview,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import { stableSorted } from '@/lib/sort';
import { useArchivedPosts, useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { PostList } from './post-list';
import { PostRow } from './post-row';
import { renderReader } from './test-helpers';

// Every request wrapper stubbed, but `ApiError` kept real: the store reads a refusal's status and
// sentence off it, which an auto-mocked constructor would never set.
jest.mock('@/lib/api-client', () => ({
  ...jest.createMockFromModule<typeof import('@/lib/api-client')>('@/lib/api-client'),
  ApiError: jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client').ApiError,
}));
const mockApi = jest.mocked(api);

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: StoredReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, html: _html, ...listItem } = makeReaderPost(PUBLICATION_ID, overrides);
  return listItem;
}

/** Render on a deployment with no Instapaper credentials — local dev. */
function renderReaderUnconfigured(ui: React.ReactElement) {
  return renderReader(ui, [], undefined, { instapaperConfigured: false });
}

/** jsdom plays no CSS transitions, so fire the exit wrapper's own transitionend by hand. */
function endExit(): void {
  const wrapper = screen.getByTestId('reader-row-collapse');
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
  fireEvent(wrapper, event);
}

/** The card itself — a button whose accessible name is the content it wraps. */
function card(): HTMLElement {
  return screen.getByRole('button', { name: /the row’s own gist/ });
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

/** An Instapaper article, as the list carries it. */
function article(overrides: Parameters<typeof makeReaderArticle>[0] = {}): ReaderPostListItem {
  const { text: _text, html: _html, ...listItem } = makeReaderArticle(overrides);
  return listItem;
}

describe('PostRow — an article from To Reader', () => {
  const SUMMARISED = {
    received_at: '2026-09-18T08:30:00.000Z',
    word_count: 2760,
    summary_state: 'done',
    gist: 'Street noise tracks foot traffic, not ordinances.',
    overview: makeReaderOverview(),
  } as const;

  it('carries its site as the eyebrow and says how it got here at the end of the meta line', () => {
    renderReader(
      <PostRow post={article({ ...SUMMARISED, site: 'worksinprogress.co' })} now={NOW} />,
    );

    expect(screen.getByText('worksinprogress.co')).toBeInTheDocument();
    expect(screen.getByText('Sep 18 · 12 min read · via Instapaper')).toBeInTheDocument();
  });

  it('names its publication instead, once the article is linked to one', () => {
    const publication = makeReaderPublicationListItem('Works in Progress');
    renderReader(
      <PostRow
        post={article({
          ...SUMMARISED,
          publication_id: publication.id,
          site: 'worksinprogress.co',
        })}
        now={NOW}
      />,
      [],
      undefined,
      { publications: [publication] },
    );

    expect(screen.getByText('Works in Progress')).toBeInTheDocument();
    expect(screen.queryByText('worksinprogress.co')).not.toBeInTheDocument();
    // The summary is the one it already had: linking renames the row, it never re-summarises.
    expect(
      screen.getByText('Street noise tracks foot traffic, not ordinances.'),
    ).toBeInTheDocument();
  });

  it('keeps the verb every row has — Send to Instapaper, on i — even with no link and no body', () => {
    renderReader(
      <PostRow
        post={article({ ...SUMMARISED, canonical_url: null, word_count: 0 })}
        now={NOW}
        selected
      />,
    );

    const send = screen.getByRole('button', { name: 'Send to Instapaper' });
    expect(send).toBeEnabled();
    expect(within(send).getByText('i')).toBeInTheDocument();
  });

  it('shows the newsletter floor states unchanged on an article with no text', () => {
    renderReader(
      <PostRow
        post={article({
          summary_state: 'failed',
          last_error: 'no readable body',
          word_count: 0,
          canonical_url: 'https://example.org/a-page',
          site: 'example.org',
        })}
        now={NOW}
      />,
    );

    expect(
      screen.getByText(
        'No summary — no readable body. The post is still here; send it or archive it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Original/ })).toHaveAttribute(
      'href',
      'https://example.org/a-page',
    );
  });
});

describe('PostRow — the collapsed row', () => {
  it('shows the author eyebrow, the date · read-time meta line, the title and the gist', () => {
    renderReader(
      <PostRow
        post={post({
          author: 'Second Thoughts',
          received_at: '2026-09-16T14:00:00.000Z',
          word_count: 3220,
          title: 'How near is the intelligence explosion, really?',
          summary_state: 'done',
          gist: 'Argues the debate conflates three different feedback loops.',
          overview: makeReaderOverview(),
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText('Second Thoughts')).toBeInTheDocument();
    // A newsletter's meta line is unchanged: only an article says how it got here.
    expect(screen.getByText('Sep 16 · 14 min read')).toBeInTheDocument();
    expect(screen.queryByText(/via Instapaper/)).not.toBeInTheDocument();
    expect(screen.getByText('How near is the intelligence explosion, really?')).toBeInTheDocument();
    expect(
      screen.getByText('Argues the debate conflates three different feedback loops.'),
    ).toBeInTheDocument();
  });

  it('falls back to a placeholder publication when author is null', () => {
    renderReader(<PostRow post={post({ author: null })} now={NOW} />);
    expect(screen.getByText('Unknown publication')).toBeInTheDocument();
  });
});

describe('PostRow — floor-state placeholders and badges', () => {
  it('pending: shows the badge and the waiting placeholder, no Overview verb', () => {
    renderReader(<PostRow post={post({ summary_state: 'pending' })} now={NOW} />);

    expect(screen.getByText('summarising…')).toBeInTheDocument();
    expect(
      screen.getByText('The summary is on its way — send it now, or check back in a few minutes.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('failed: draws the middle clause from last_error', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'failed',
          last_error: "the model's output didn't fit the schema three times",
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText('summary failed')).toBeInTheDocument();
    expect(
      screen.getByText(
        "No summary — the model's output didn't fit the schema three times. The post is still here; send it or archive it.",
      ),
    ).toBeInTheDocument();
  });

  it('failed: falls back to a generic clause when last_error is absent', () => {
    renderReader(<PostRow post={post({ summary_state: 'failed', last_error: null })} now={NOW} />);

    expect(
      screen.getByText(
        "No summary — the model couldn't produce one. The post is still here; send it or archive it.",
      ),
    ).toBeInTheDocument();
  });

  it('refused: draws the middle clause from last_error', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'refused',
          last_error: 'this post walks through exploit chains in operational detail',
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText('summary refused')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No summary — this post walks through exploit chains in operational detail. ' +
          'The post is still here; send it or archive it.',
      ),
    ).toBeInTheDocument();
  });

  it('refused: falls back to a generic clause when last_error is absent', () => {
    renderReader(<PostRow post={post({ summary_state: 'refused', last_error: null })} now={NOW} />);

    expect(
      screen.getByText(
        'No summary — the model declined to summarise this one. The post is still here; send it or archive it.',
      ),
    ).toBeInTheDocument();
  });

  it('failed and refused rows are dimmed', () => {
    renderReader(<PostRow post={post({ summary_state: 'failed' })} now={NOW} />);
    expect(screen.getByTestId('reader-row')).toHaveClass('opacity-70');
  });

  it('done rows carry no badge', () => {
    renderReader(
      <PostRow
        post={post({ summary_state: 'done', gist: 'a gist', overview: makeReaderOverview() })}
        now={NOW}
      />,
    );
    expect(screen.queryByText('summarising…')).not.toBeInTheDocument();
    expect(screen.queryByText('summary failed')).not.toBeInTheDocument();
    expect(screen.queryByText('summary refused')).not.toBeInTheDocument();
  });
});

/** Every button and link inside `container`, by label, in the order they are drawn. */
function verbsIn(container: HTMLElement): (string | null)[] {
  const scope = within(container);
  return stableSorted(
    [...scope.queryAllByRole('button'), ...scope.queryAllByRole('link')],
    (left, right) =>
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  ).map((element) => element.textContent);
}

/** The verbs directly under the card, in the order drawn — the panel's footer is not among them. */
function verbRow(): (string | null)[] {
  return verbsIn(screen.getByTestId('reader-row-verbs'));
}

describe('PostRow — the verb row', () => {
  it('leads with Send to Instapaper on a done row, and draws no Open', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'done',
          gist: 'g',
          overview: makeReaderOverview(),
          word_count: 900,
        })}
        now={NOW}
      />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Overview', 'Archive']);
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('ends a failed row with Original, since it has no panel to hold it', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'failed',
          word_count: 900,
          canonical_url: 'https://example.substack.com/p/a-post',
        })}
        now={NOW}
      />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Retry summary', 'Archive', 'Original']);
  });

  it('ends a first-time pending row with Original too', () => {
    renderReader(
      <PostRow
        post={post({ summary_state: 'pending', canonical_url: 'https://example.test/p/a' })}
        now={NOW}
      />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Archive', 'Original']);
  });

  it('reads Unarchive in Archive’s slot in the archive', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'done',
          gist: 'g',
          overview: makeReaderOverview(),
          archived_at: '2026-09-17T09:00:00.000Z',
        })}
        now={NOW}
        variant="archive"
      />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Overview', 'Unarchive']);
  });
});

describe('PostRow — Original', () => {
  it('links to the canonical URL, in a new tab', () => {
    renderReader(
      <PostRow post={post({ canonical_url: 'https://example.substack.com/p/a-post' })} now={NOW} />,
    );

    const link = screen.getByRole('link', { name: 'Original' });
    expect(link).toHaveAttribute('href', 'https://example.substack.com/p/a-post');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link.className).toContain('text-muted-foreground');
  });

  it('falls back to the Gmail permalink when there is no canonical URL', () => {
    renderReader(
      <PostRow
        post={post({ canonical_url: null, rfc822_message_id: '<import-ai-412@mail.substack.com>' })}
        now={NOW}
      />,
    );

    expect(screen.getByRole('link', { name: 'Original' })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#search/rfc822msgid:import-ai-412%40mail.substack.com',
    );
  });

  it('is absent when there is nowhere to point — no disabled stand-in', () => {
    renderReader(
      <PostRow post={post({ canonical_url: null, rfc822_message_id: null })} now={NOW} selected />,
    );

    expect(screen.queryByRole('link', { name: 'Original' })).not.toBeInTheDocument();
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
  });

  it('stamps opened on click, without calling preventDefault', () => {
    mockApi.patchReaderPost.mockResolvedValue(
      post({ canonical_url: 'https://example.substack.com/p/a-post' }),
    );
    renderReader(
      <PostRow
        post={post({ id: 'p-1', canonical_url: 'https://example.substack.com/p/a-post' })}
        now={NOW}
      />,
    );
    const link = screen.getByRole('link', { name: 'Original' });

    // A real `click()` rather than a mocked one — the assertion below is that navigation was
    // never prevented. jsdom's own default action for an anchor click is unimplemented and logs
    // rather than throws, so this is safe to run for real.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, event);

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { opened: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it('joins the panel footer, before Re-summarise, on a row that has a panel', async () => {
    const user = userEvent.setup();
    renderReader(
      <PostRow
        post={post({
          summary_state: 'done',
          gist: 'g',
          overview: makeReaderOverview(),
          word_count: 900,
          model: 'claude-sonnet-5',
          canonical_url: 'https://example.test/p/a',
        })}
        now={NOW}
      />,
    );

    expect(verbRow()).not.toContain('Original');
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(verbsIn(screen.getByTestId('reader-row-overview'))).toEqual([
      'Original',
      'Re-summarise',
    ]);
  });

  it('still reaches the footer of a panel that holds only an overview', async () => {
    // A done post whose text was swept has an overview but no re-run verb and — with no model on
    // record — no stamp; the footer used to be absent, and now it is Original's only home.
    const user = userEvent.setup();
    renderReader(
      <PostRow
        post={post({
          summary_state: 'done',
          gist: 'g',
          overview: makeReaderOverview(),
          text_swept_at: '2026-09-08T03:00:00.000Z',
          canonical_url: 'https://example.test/p/a',
        })}
        now={NOW}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(
      within(screen.getByTestId('reader-row-overview')).getByRole('link', { name: 'Original' }),
    ).toBeInTheDocument();
  });

  it('never makes a panel of its own on a row with nothing to disclose', () => {
    renderReader(
      <PostRow
        post={post({ summary_state: 'failed', canonical_url: 'https://example.test/p/a' })}
        now={NOW}
      />,
    );

    expect(screen.queryByTestId('reader-row-overview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
  });
});

function sendButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Send to Instapaper' });
}

describe('PostRow — Send to Instapaper', () => {
  const SENDABLE = {
    id: 'p-1',
    canonical_url: 'https://example.test/p/alpha',
    word_count: 900,
    summary_state: 'done',
    gist: 'a gist',
  } as const;

  it('plays the archive exit on the list, then sends, telling the list as the exit starts', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post(SENDABLE);
    mockApi.sendReaderPostToInstapaper.mockResolvedValue({
      ...row,
      archived_at: '2026-09-18T09:00:00.000Z',
      instapaper_sent_at: '2026-09-18T09:00:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} onExit={onExit} />, [row]);

    await user.click(sendButton());

    expect(onExit).toHaveBeenCalledWith('p-1');
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
    expect(screen.getByTestId('reader-row-collapse').className).toContain('grid-rows-[0fr]');

    endExit();

    await waitFor(() => {
      expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledWith('p-1');
    });
  });

  it('sends in place from the archive — no exit, and the badge appears at once', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post({ ...SENDABLE, archived_at: '2026-09-17T09:00:00.000Z' });
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));

    function Live() {
      const archived = useArchivedPosts();
      const current = archived[0];
      return current === undefined ? null : (
        <PostRow post={current} now={NOW} variant="archive" onExit={onExit} />
      );
    }
    renderReader(<Live />, [row]);

    expect(screen.queryByText('in Instapaper')).not.toBeInTheDocument();
    await user.click(sendButton());

    expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledWith('p-1');
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByTestId('reader-row-collapse').className).toContain('grid-rows-[1fr]');
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
  });

  it('does nothing on a second press while the first send is in flight', async () => {
    const user = userEvent.setup();
    const row = post({ ...SENDABLE, archived_at: '2026-09-17T09:00:00.000Z' });
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} variant="archive" />, [row]);

    await user.click(sendButton());
    await user.click(sendButton());

    expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledTimes(1);
  });

  it('toasts the route’s own sentence when the send fails', async () => {
    const user = userEvent.setup();
    const row = post(SENDABLE);
    mockApi.sendReaderPostToInstapaper.mockRejectedValue(
      new api.ApiError('API POST failed: 422', 422, 'This publication has opted out of Instapaper'),
    );
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.click(sendButton());
    endExit();

    expect(
      await screen.findByText('This publication has opted out of Instapaper'),
    ).toBeInTheDocument();
  });

  it('is disabled, and says why, on a deployment with no Instapaper', () => {
    renderReaderUnconfigured(<PostRow post={post(SENDABLE)} now={NOW} selected />);

    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute('title', "Instapaper isn't set up on this deployment.");
    // No keycap: the key does nothing while the verb can't run.
    expect(within(sendButton()).queryByText('i')).not.toBeInTheDocument();
  });

  it.each([
    ['its text was swept', { text_swept_at: '2026-09-08T03:00:00.000Z' }],
    ['it never had any', { word_count: 0 }],
  ])('is disabled, and says why, with no link and no stored text — %s', (_label, overrides) => {
    renderReader(
      <PostRow post={post({ ...SENDABLE, canonical_url: null, ...overrides })} now={NOW} />,
    );

    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute('title', 'No link and no stored text to send.');
  });

  it('stays live for a post with a body but no link — it goes as a private bookmark', () => {
    renderReader(<PostRow post={post({ ...SENDABLE, canonical_url: null })} now={NOW} />);
    expect(sendButton()).toBeEnabled();
  });

  it('stays live for a swept post that still has its link — Instapaper fetches it', () => {
    renderReader(
      <PostRow post={post({ ...SENDABLE, text_swept_at: '2026-09-08T03:00:00.000Z' })} now={NOW} />,
    );
    expect(sendButton()).toBeEnabled();
  });

  it('wears the in Instapaper badge once the post has been sent, beside a state badge', () => {
    renderReader(
      <PostRow
        post={post({
          ...SENDABLE,
          summary_state: 'failed',
          instapaper_sent_at: '2026-09-18T09:00:00.000Z',
        })}
        now={NOW}
        variant="archive"
      />,
    );

    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
    expect(screen.getByText('summary failed')).toBeInTheDocument();
  });
});

describe('PostRow — the keys', () => {
  const KEYED = {
    id: 'p-1',
    canonical_url: 'https://example.test/p/alpha',
    word_count: 900,
    summary_state: 'done',
    gist: 'a gist',
    overview: makeReaderOverview(),
  } as const;

  it('i sends the selected row, playing the same exit as the button', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post(KEYED);
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} selected onExit={onExit} />, [row]);

    await user.keyboard('i');

    expect(onExit).toHaveBeenCalledWith('p-1');
    endExit();
    await waitFor(() => {
      expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledWith('p-1');
    });
  });

  it('i does nothing while the verb is disabled', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post(KEYED);
    renderReaderUnconfigured(<PostRow post={row} now={NOW} selected onExit={onExit} />);

    await user.keyboard('i');
    endExit();

    expect(onExit).not.toHaveBeenCalled();
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
  });

  it('o opens the original of a done row whose panel is closed, and stamps it opened', async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const row = post(KEYED);
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    await user.keyboard('o');

    expect(open).toHaveBeenCalledWith(
      'https://example.test/p/alpha',
      '_blank',
      'noopener,noreferrer',
    );
    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { opened: true });
  });

  it('o does nothing on a post with nowhere to point', async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
    const row = post({ ...KEYED, canonical_url: null, rfc822_message_id: null });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    await user.keyboard('o');

    expect(open).not.toHaveBeenCalled();
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();
  });

  it('shows i on Send and o on Original, on the selected row only', async () => {
    const user = userEvent.setup();
    const row = post({ ...KEYED, model: 'claude-sonnet-5' });
    const { rerender } = renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    expect(
      within(screen.getByRole('button', { name: 'Send to Instapaper' })).getByText('i'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(
      within(screen.getByRole('link', { name: 'Original' })).getByText('o'),
    ).toBeInTheDocument();

    rerender(<PostRow post={row} now={NOW} />);
    expect(
      within(screen.getByRole('button', { name: 'Send to Instapaper' })).queryByText('i'),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: 'Original' })).queryByText('o'),
    ).not.toBeInTheDocument();
  });
});

describe('PostRow — Overview', () => {
  it('is absent on a row without a summary', () => {
    renderReader(<PostRow post={post({ summary_state: 'pending' })} now={NOW} />);
    expect(screen.queryByRole('button', { name: /overview/i })).not.toBeInTheDocument();
  });

  it('is absent when a done row fails the overview guard', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'done',
          gist: 'a gist',
          overview: { broken: true } as unknown as ReaderOverview,
        })}
        now={NOW}
      />,
    );
    expect(screen.queryByRole('button', { name: /overview/i })).not.toBeInTheDocument();
    expect(screen.getByText('a gist')).toBeInTheDocument();
  });

  it('toggles from the verb, showing the four sections', async () => {
    const user = userEvent.setup();
    const overview = makeReaderOverview();
    renderReader(
      <PostRow post={post({ summary_state: 'done', gist: 'a gist', overview })} now={NOW} />,
    );

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByText('Novel ideas')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('The argument')).toBeInTheDocument();
    expect(screen.getByText('Who should read it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide overview' })).toBeInTheDocument();
  });

  it('toggles from the row body too', async () => {
    const user = userEvent.setup();
    const overview = makeReaderOverview();
    renderReader(
      <PostRow post={post({ summary_state: 'done', gist: 'a gist', overview })} now={NOW} />,
    );

    await user.click(screen.getByText('a gist'));

    expect(screen.getByRole('button', { name: 'Hide overview' })).toBeInTheDocument();
    expect(screen.getByTestId('reader-row')).toHaveClass('border-accent-green/60');
  });
});

describe('PostRow — Novel ideas, Evidence and the wiki', () => {
  const IDEAS = ['Idea one', 'Idea two', 'Idea three'];
  const EVIDENCE = ['Evidence one'];
  const WIKI_POST_ID = '22222222-2222-4222-8222-222222222222';
  const withIdeas = (sent: string[] = []) =>
    post({
      id: WIKI_POST_ID,
      summary_state: 'done',
      gist: 'a gist',
      overview: makeReaderOverview({ novel_ideas: IDEAS, evidence: EVIDENCE }),
      wiki_sent_ideas: sent,
    });

  /** The row as the list mounts it: fed from the store, so a reconciled send redraws it. */
  function LiveRow() {
    const row = useReaderPosts().find((candidate) => candidate.id === WIKI_POST_ID);
    return row === undefined ? null : <PostRow post={row} now={NOW} />;
  }

  it('keeps the plain bulleted list when the wiki is not connected', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={withIdeas()} now={NOW} />, [withIdeas()]);

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByText('Idea one')).toBeInTheDocument();
    expect(screen.getByText('Evidence one')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to wiki|Select all/ })).not.toBeInTheDocument();
  });

  it('offers the checklist, reading the sent marks off the post, when it is connected', async () => {
    const user = userEvent.setup();
    renderReader(
      <PostRow post={withIdeas(['Idea one'])} now={NOW} />,
      [withIdeas(['Idea one'])],
      undefined,
      {
        wikiWritable: true,
      },
    );

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Evidence one' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toBeInTheDocument();
  });

  it('drops the ticks when the overview is collapsed', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={withIdeas()} now={NOW} />, [withIdeas()], undefined, {
      wikiWritable: true,
    });
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('checkbox', { name: 'Idea two' }));
    await user.click(screen.getByRole('checkbox', { name: 'Evidence one' }));

    await user.click(screen.getByRole('button', { name: 'Hide overview' }));
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByRole('checkbox', { name: 'Idea two' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('checkbox', { name: 'Evidence one' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByRole('group', { name: 'Selected bullets' })).not.toBeInTheDocument();
  });

  it('holds every control while a send started before a collapse is still in the air', async () => {
    const user = userEvent.setup();
    let settle!: (row: ReaderPostListItem) => void;
    mockApi.sendReaderPicksToWiki.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderReader(<LiveRow />, [withIdeas()], undefined, { wikiWritable: true });
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('checkbox', { name: 'Idea two' }));
    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    await user.click(screen.getByRole('button', { name: 'Hide overview' }));
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeDisabled();
    expect(mockApi.sendReaderPicksToWiki).toHaveBeenCalledTimes(1);

    settle(withIdeas(['Idea two']));
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Idea two' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Idea one' })).toBeEnabled();
  });

  it('lands a send whose row was collapsed mid-flight, and reads it sent on reopening', async () => {
    const user = userEvent.setup();
    let settle!: (row: ReaderPostListItem) => void;
    mockApi.sendReaderPicksToWiki.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderReader(<LiveRow />, [withIdeas()], undefined, { wikiWritable: true });
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('checkbox', { name: 'Idea two' }));
    await user.click(screen.getByRole('button', { name: 'Send to wiki' }));

    await user.click(screen.getByRole('button', { name: 'Hide overview' }));
    settle(withIdeas(['Idea two']));
    await user.click(await screen.findByRole('button', { name: 'Overview' }));

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Idea two' })).not.toBeInTheDocument();
  });
});

describe('PostRow — the disclosure', () => {
  const PANEL_ROW = {
    id: 'p-1',
    summary_state: 'done',
    gist: 'the row’s own gist',
    word_count: 3220,
  } as const;

  it('says what it controls, and that it is shut, when there is a panel', () => {
    renderReader(
      <PostRow post={post({ ...PANEL_ROW, overview: makeReaderOverview() })} now={NOW} />,
    );

    const panel = screen.getByTestId('reader-row-overview').parentElement;
    expect(card()).toHaveAttribute('aria-expanded', 'false');
    expect(card()).toHaveAttribute('aria-controls', panel?.id ?? '');
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-controls',
      panel?.id ?? '',
    );
  });

  it('claims no disclosure at all on a row with nothing to disclose', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={post({ ...PANEL_ROW, summary_state: 'pending' })} now={NOW} />);

    expect(card()).not.toHaveAttribute('aria-expanded');
    expect(card()).not.toHaveAttribute('aria-controls');

    // The click still points the keyboard here; it just has nothing to open.
    await user.click(card());

    expect(card()).not.toHaveAttribute('aria-expanded');
    expect(screen.getByTestId('reader-row').className).not.toContain('bg-secondary/40');
  });

  it('reaches the panel of a done row whose overview failed the guard', async () => {
    const user = userEvent.setup();
    const row = post({
      ...PANEL_ROW,
      overview: { broken: true } as unknown as ReaderOverview,
      model: 'claude-sonnet-5',
      prompt_version: 2,
      summarized_at: '2026-09-16T14:05:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByText('claude-sonnet-5 · prompt v2 · Sep 16')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-summarise' })).toBeInTheDocument();
  });

  it('answers v on a done row whose only panel content is the stamp', async () => {
    const user = userEvent.setup();
    const row = post({
      ...PANEL_ROW,
      overview: { broken: true } as unknown as ReaderOverview,
      word_count: 0,
      model: 'claude-sonnet-5',
      prompt_version: 2,
      summarized_at: '2026-09-16T14:05:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    await user.keyboard('v');

    expect(screen.getByRole('button', { name: 'Hide overview' })).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-5 · prompt v2 · Sep 16')).toBeInTheDocument();
  });
});

describe('PostRow — every verb points the keyboard at its own row', () => {
  const ROW = {
    id: 'p-1',
    canonical_url: 'https://example.test/alpha',
    word_count: 900,
    gist: 'a gist',
  } as const;

  it.each([
    ['Send to Instapaper', post({ ...ROW, summary_state: 'done', overview: makeReaderOverview() })],
    ['Original', post({ ...ROW, summary_state: 'failed' })],
    ['Overview', post({ ...ROW, summary_state: 'done', overview: makeReaderOverview() })],
    ['Retry summary', post({ ...ROW, summary_state: 'failed' })],
    ['Archive', post({ ...ROW, summary_state: 'done', overview: makeReaderOverview() })],
  ])('%s', async (name, row) => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} onSelect={onSelect} />, [row]);

    await user.click(screen.getByRole(name === 'Original' ? 'link' : 'button', { name }));

    expect(onSelect).toHaveBeenCalledWith('p-1');
  });

  it('Re-summarise, from inside the panel', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const row = post({
      ...ROW,
      summary_state: 'done',
      overview: makeReaderOverview(),
      model: 'claude-sonnet-5',
    });
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} onSelect={onSelect} />, [row]);

    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Re-summarise' }));

    expect(onSelect).toHaveBeenNthCalledWith(2, 'p-1');
  });
});

describe('PostRow — Archive', () => {
  it('runs the exit animation then the store action', async () => {
    const user = userEvent.setup();
    mockApi.patchReaderPost.mockResolvedValue(post({ archived_at: '2026-09-18T09:00:00.000Z' }));
    renderReader(<PostRow post={post({ id: 'p-1' })} now={NOW} />);

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();

    endExit();

    await screen.findByTestId('reader-row-collapse');
    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { archived: true });
  });

  it('toasts when the archive fails — the list-level test covers the row reappearing', async () => {
    const user = userEvent.setup();
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    renderReader(<PostRow post={post({ id: 'p-1' })} now={NOW} />);

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    endExit();

    expect(await screen.findByText("Couldn't archive that post")).toBeInTheDocument();
  });
});

describe('PostRow — Retry summary', () => {
  it('offers the verb on a failed row and queues the post when it is clicked', async () => {
    const user = userEvent.setup();
    const row = post({ id: 'p-1', summary_state: 'failed', word_count: 6500 });
    mockApi.patchReaderPost.mockResolvedValue({ ...row, summary_state: 'pending' });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.click(screen.getByRole('button', { name: 'Retry summary' }));

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { resummarize: true });
  });

  it('offers the verb on a refused row too — the owner overrides "no retry"', () => {
    const row = post({ summary_state: 'refused', word_count: 420 });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByRole('button', { name: 'Retry summary' })).toBeInTheDocument();
  });

  it('is absent while a summary is still on its way', () => {
    renderReader(<PostRow post={post({ summary_state: 'pending', word_count: 900 })} now={NOW} />);

    expect(screen.queryByRole('button', { name: 'Retry summary' })).not.toBeInTheDocument();
  });

  it('is absent once the text has been swept — a re-run could only fail', () => {
    const row = post({
      summary_state: 'failed',
      word_count: 6500,
      text_swept_at: '2026-09-08T03:00:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} />);

    expect(screen.queryByRole('button', { name: 'Retry summary' })).not.toBeInTheDocument();
  });

  it('is absent on a post that never had a body to summarise', () => {
    const row = post({ summary_state: 'failed', word_count: 0, last_error: 'no readable body' });
    renderReader(<PostRow post={row} now={NOW} />);

    expect(screen.queryByRole('button', { name: 'Retry summary' })).not.toBeInTheDocument();
  });
});

describe('PostRow — the summary stamp and Re-summarise', () => {
  const DONE = {
    summary_state: 'done',
    gist: 'a gist',
    word_count: 3220,
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-16T14:05:00.000Z',
  } as const;

  it('stamps which model wrote the summary, under which prompt, and when', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={post({ ...DONE, overview: makeReaderOverview() })} now={NOW} />);

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByText('claude-sonnet-5 · prompt v2 · Sep 16')).toBeInTheDocument();
  });

  it('offers the ghost re-run beneath the overview, and queues the post', async () => {
    const user = userEvent.setup();
    const row = post({ id: 'p-1', ...DONE, overview: makeReaderOverview() });
    mockApi.patchReaderPost.mockResolvedValue({ ...row, summary_state: 'pending' });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Re-summarise' }));

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { resummarize: true });
  });

  it('never offers the re-run as the row’s primary "Retry summary" verb', () => {
    renderReader(<PostRow post={post({ ...DONE, overview: makeReaderOverview() })} now={NOW} />);

    expect(screen.queryByRole('button', { name: 'Retry summary' })).not.toBeInTheDocument();
  });

  it('keeps the stamp but drops the verb once the text has been swept', async () => {
    const user = userEvent.setup();
    renderReader(
      <PostRow
        post={post({
          ...DONE,
          overview: makeReaderOverview(),
          text_swept_at: '2026-09-08T03:00:00.000Z',
        })}
        now={NOW}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByText('claude-sonnet-5 · prompt v2 · Sep 16')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-summarise' })).not.toBeInTheDocument();
  });
});

describe('PostRow — a summary being replaced', () => {
  it('keeps the previous gist under the pending marker rather than blanking it', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'pending',
          gist: 'the summary it already has',
          word_count: 3220,
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText('summarising…')).toBeInTheDocument();
    const gist = screen.getByText('the summary it already has');
    expect(gist).toHaveClass('opacity-60');
  });

  it('keeps the previous overview reachable while the re-run is queued', () => {
    renderReader(
      <PostRow
        post={post({
          summary_state: 'pending',
          gist: 'the summary it already has',
          overview: makeReaderOverview(),
        })}
        now={NOW}
      />,
    );

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });

  it('still shows the waiting placeholder for a post that has never been summarised', () => {
    renderReader(<PostRow post={post({ summary_state: 'pending', gist: null })} now={NOW} />);

    expect(
      screen.getByText('The summary is on its way — send it now, or check back in a few minutes.'),
    ).toBeInTheDocument();
  });
});

describe('PostRow — a swept post', () => {
  it('says the text was swept, and why that is the end of it', () => {
    renderReader(
      <PostRow
        post={post({ summary_state: 'refused', text_swept_at: '2026-09-08T03:00:00.000Z' })}
        now={NOW}
      />,
    );

    expect(
      screen.getByText(
        "No summary — the model declined to summarise this one. Its text was swept on Sep 8, so it can't be retried; send it or archive it.",
      ),
    ).toBeInTheDocument();
  });

  it('keeps the ordinary failed line for a post that simply had no body', () => {
    renderReader(
      <PostRow
        post={post({ summary_state: 'failed', word_count: 0, last_error: 'no readable body' })}
        now={NOW}
      />,
    );

    expect(
      screen.getByText(
        'No summary — no readable body. The post is still here; send it or archive it.',
      ),
    ).toBeInTheDocument();
  });
});

describe('PostRow — selection', () => {
  const SELECTABLE = {
    id: 'p-1',
    title: 'Alpha',
    canonical_url: 'https://example.test/alpha',
    word_count: 900,
    summary_state: 'done',
    gist: 'The only one.',
  } as const;

  it('goes unmarked and unringed while another row holds the selection', () => {
    const row = post({ ...SELECTABLE, overview: makeReaderOverview() });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByTestId('reader-row').dataset['selected']).toBe('false');
    expect(screen.getByTestId('reader-row').className).not.toContain('ring-1');
  });

  it('marks itself for the keyboard and wears the ring once it holds the selection', () => {
    const row = post({ ...SELECTABLE, overview: makeReaderOverview() });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    expect(screen.getByTestId('reader-row').dataset['selected']).toBe('true');
    expect(screen.getByTestId('reader-row').className).toContain('ring-1');
  });

  it('is selected and expanded independently — a selected row need not be open', async () => {
    const user = userEvent.setup();
    const row = post({ ...SELECTABLE, overview: makeReaderOverview() });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByTestId('reader-row').className).not.toContain('bg-secondary/40');

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByTestId('reader-row').className).toContain('bg-secondary/40');
    expect(screen.getByTestId('reader-row').className).toContain('ring-1');
  });

  it('asks to be selected when its card is clicked, without ever asking to be cleared', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const row = post({ ...SELECTABLE, overview: makeReaderOverview() });
    renderReader(<PostRow post={row} now={NOW} selected onSelect={onSelect} />, [row]);

    await user.click(screen.getByText('Alpha'));
    await user.click(screen.getByText('Alpha'));

    expect(onSelect).toHaveBeenNthCalledWith(1, 'p-1');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'p-1');
  });

  it('answers no verb key while another row holds the selection', async () => {
    const user = userEvent.setup();
    const row = post({ ...SELECTABLE, overview: makeReaderOverview() });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.keyboard('ve');

    expect(screen.queryByRole('heading', { name: 'Novel ideas' })).not.toBeInTheDocument();
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();
  });
});

describe('PostRow — the archive variant', () => {
  const ARCHIVED = {
    id: 'p-1',
    title: 'Alpha',
    canonical_url: 'https://example.test/alpha',
    word_count: 900,
    summary_state: 'done',
    gist: 'Put away a while ago.',
    archived_at: '2026-09-18T08:00:00.000Z',
  } as const;

  it('reverses the archive verb and tells the list as the exit starts', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post(ARCHIVED);
    mockApi.patchReaderPost.mockResolvedValue({ ...row, archived_at: null });
    renderReader(<PostRow post={row} now={NOW} variant="archive" onExit={onExit} />, [row]);

    await user.click(screen.getByRole('button', { name: 'Unarchive' }));

    // The list is told at once, so the selection moves on while the collapse is still playing.
    expect(onExit).toHaveBeenCalledWith('p-1');
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();

    endExit();

    await waitFor(() => {
      expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { archived: false });
    });
  });

  it('toasts and keeps the row when the unarchive fails', async () => {
    const user = userEvent.setup();
    const row = post(ARCHIVED);
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    renderReader(<PostRow post={row} now={NOW} variant="archive" />, [row]);

    await user.click(screen.getByRole('button', { name: 'Unarchive' }));
    endExit();

    expect(await screen.findByText("Couldn't unarchive that post")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A research post: the question while its report is being written, then the report
// ---------------------------------------------------------------------------

/** An ISO instant `minutes` before the pinned clock, so a post's age is stated, not implied. */
function minutesBeforeNow(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

const SESSION_URL = 'https://claude.ai/code/session_01Abc';
const QUESTION = 'Is a cold-climate heat pump worth it for our Chicago house?';

/** A research post as the list carries it: no bodies, no brief. Defaults to a fresh, running one. */
function research(overrides: Parameters<typeof makeResearchPost>[0] = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    research_brief: _brief,
    ...listItem
  } = makeResearchPost({
    id: 'p-r',
    title: QUESTION,
    received_at: minutesBeforeNow(20),
    created_at: minutesBeforeNow(20),
    research_fired_at: minutesBeforeNow(19),
    research_session_url: SESSION_URL,
    ...overrides,
  });
  return listItem;
}

/** A post whose Routine fire has not been accepted yet: two minutes old, so not yet presumed lost. */
/** A post the RPC just created: queued, no fire claimed against it yet. */
const JUST_QUEUED = {
  research_state: 'queued',
  created_at: minutesBeforeNow(2),
  received_at: minutesBeforeNow(2),
  research_fired_at: null,
  research_attempts: 0,
} as const;

/** A report that has arrived and been summarised. */
function report(overrides: Parameters<typeof makeResearchPost>[0] = {}): ReaderPostListItem {
  return research({
    research_state: 'done',
    research_delivered_at: minutesBeforeNow(5),
    received_at: minutesBeforeNow(5),
    word_count: 2530,
    summary_state: 'done',
    gist: 'Probably yes if the furnace is near the end of its life.',
    overview: makeReaderOverview(),
    model: 'claude-sonnet-5',
    prompt_version: 1,
    summarized_at: minutesBeforeNow(4),
    ...overrides,
  });
}

/** The row drawn by what the store holds, so an action's effect on the row can be watched. */
function StoreList() {
  const posts = useReaderPosts();
  return <PostList posts={posts} now={NOW} />;
}

describe('PostRow — a research post while the report is being written', () => {
  it.each([
    ['running', {}],
    ['just queued', JUST_QUEUED],
  ] as const)(
    '%s: the eyebrow, the date alone, the badge, the title and the waiting line',
    (_label, overrides) => {
      renderReader(<PostRow post={research(overrides)} now={NOW} />);

      expect(screen.getByText('Research')).toBeInTheDocument();
      // No body yet, so no read time to promise.
      expect(screen.getByText('Sep 18')).toBeInTheDocument();
      expect(screen.queryByText(/min read/)).not.toBeInTheDocument();
      expect(screen.getByText('researching…')).toBeInTheDocument();
      expect(screen.queryByText('summarising…')).not.toBeInTheDocument();
      expect(screen.getByText(QUESTION)).toBeInTheDocument();
      expect(
        screen.getByText(
          'Researching on the web — the report lands here, usually within the hour.',
        ),
      ).toHaveClass('italic');
      expect(screen.getByTestId('reader-row')).not.toHaveClass('opacity-70');
    },
  );

  it('draws Send disabled with the reason, then Archive, then the Session link', () => {
    renderReader(<PostRow post={research()} now={NOW} />);

    expect(verbRow()).toEqual(['Send to Instapaper', 'Archive', 'Session']);
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute('title', "The report hasn't arrived yet.");
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('opens the session in a new tab from the Session link, stamping the post opened', async () => {
    const user = userEvent.setup();
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const row = research();
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    const link = screen.getByRole('link', { name: 'Session' });
    expect(link).toHaveAttribute('href', SESSION_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: 'Original' })).not.toBeInTheDocument();

    await user.click(link);

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-r', { opened: true });
  });

  it('draws no Session link, and no disabled stand-in, before the fire has a session URL', () => {
    renderReader(
      <PostRow post={research({ ...JUST_QUEUED, research_session_url: null })} now={NOW} />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Archive']);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not treat a session URL that is not a web address as a link', () => {
    renderReader(
      <PostRow post={research({ research_session_url: 'javascript:alert(1)' })} now={NOW} />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('archives like any post: the exit, then the write', async () => {
    const user = userEvent.setup();
    const row = research();
    mockApi.patchReaderPost.mockResolvedValue({ ...row, archived_at: '2026-09-18T09:00:00.000Z' });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    endExit();

    await waitFor(() => {
      expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-r', { archived: true });
    });
  });

  it('answers i with nothing while Send is disabled, and shows no keycap on it', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = research();
    renderReader(<PostRow post={row} now={NOW} selected onExit={onExit} />, [row]);

    await user.keyboard('i');
    endExit();

    expect(onExit).not.toHaveBeenCalled();
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
    expect(within(sendButton()).queryByText('i')).not.toBeInTheDocument();
  });

  it('answers o by opening the session and stamping the post, and hints it on Session', async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const row = research();
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    expect(
      within(screen.getByRole('link', { name: 'Session' })).getByText('o'),
    ).toBeInTheDocument();
    await user.keyboard('o');

    expect(open).toHaveBeenCalledWith(SESSION_URL, '_blank', 'noopener,noreferrer');
    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-r', { opened: true });
  });

  it('answers o with nothing before there is a session to open', async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
    renderReader(
      <PostRow
        post={research({ ...JUST_QUEUED, research_session_url: null })}
        now={NOW}
        selected
      />,
    );

    await user.keyboard('o');

    expect(open).not.toHaveBeenCalled();
    expect(mockApi.patchReaderPost).not.toHaveBeenCalled();
  });
});

describe('PostRow — a research post with no report', () => {
  const FAILED = {
    research_state: 'failed',
    research_session_url: null,
    research_error: 'the research Routine answered HTTP 502',
  } as const;

  it('wears the alert badge, dims the row, and says why in the refused fire’s own words', () => {
    renderReader(<PostRow post={research(FAILED)} now={NOW} />);

    expect(screen.getByText('no report')).toBeInTheDocument();
    expect(screen.queryByText('researching…')).not.toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Sep 18')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No report — the research Routine answered HTTP 502. Retry to start a new session.',
      ),
    ).toHaveClass('italic');
    expect(screen.getByTestId('reader-row')).toHaveClass('opacity-70');
  });

  it('falls back to a generic clause when the fire stored no reason', () => {
    renderReader(<PostRow post={research({ ...FAILED, research_error: null })} now={NOW} />);

    expect(
      screen.getByText(
        'No report — the research couldn’t be started. Retry to start a new session.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Retry research, Archive and — when a session exists — Session, and no Send', () => {
    renderReader(
      <PostRow post={research({ ...FAILED, research_session_url: SESSION_URL })} now={NOW} />,
    );

    expect(verbRow()).toEqual(['Retry research', 'Archive', 'Session']);
    expect(screen.queryByRole('button', { name: 'Send to Instapaper' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Session' })).toHaveAttribute('href', SESSION_URL);
  });

  it('draws no Session link when the fire never got a session', () => {
    renderReader(<PostRow post={research(FAILED)} now={NOW} />);
    expect(verbRow()).toEqual(['Retry research', 'Archive']);
  });

  it('reads a session silent for three hours as no report, and says so', () => {
    renderReader(
      <PostRow
        post={research({ research_state: 'researching', research_fired_at: minutesBeforeNow(181) })}
        now={NOW}
      />,
    );

    expect(screen.getByText('no report')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No report — the session hasn’t reported back in 3 hours. Open it, or retry to start a new one.',
      ),
    ).toBeInTheDocument();
    expect(verbRow()).toEqual(['Retry research', 'Archive', 'Session']);
    expect(screen.getByTestId('reader-row')).toHaveClass('opacity-70');
  });

  it('keeps a session a minute inside its three hours researching', () => {
    renderReader(
      <PostRow
        post={research({ research_state: 'researching', research_fired_at: minutesBeforeNow(179) })}
        now={NOW}
      />,
    );

    expect(screen.getByText('researching…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry research' })).not.toBeInTheDocument();
  });

  it('reads a post whose fire never happened as no report, and says the research never started', () => {
    renderReader(
      <PostRow
        post={research({
          ...JUST_QUEUED,
          created_at: minutesBeforeNow(11),
          research_session_url: null,
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText('no report')).toBeInTheDocument();
    expect(
      screen.getByText('No report — the research never started. Retry to start a session.'),
    ).toBeInTheDocument();
    expect(verbRow()).toEqual(['Retry research', 'Archive']);
  });

  it('starts a new session when Retry research is clicked, and the row reads as researching at once', async () => {
    const user = userEvent.setup();
    const row = research(FAILED);
    mockApi.retryResearch.mockReturnValue(new Promise(() => {}));
    renderReader(<StoreList />, [row]);

    await user.click(screen.getByRole('button', { name: 'Retry research' }));

    expect(mockApi.retryResearch).toHaveBeenCalledWith('p-r');
    expect(screen.getByText('researching…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry research' })).not.toBeInTheDocument();
    expect(screen.queryByText('no report')).not.toBeInTheDocument();
  });

  it('shows the row the route answered with — a fire refused again is no report, with the new reason', async () => {
    const user = userEvent.setup();
    const row = research(FAILED);
    mockApi.retryResearch.mockResolvedValue({
      ...row,
      research_attempts: 2,
      research_error: 'the Routine’s daily run cap or usage limit was reached',
    });
    renderReader(<StoreList />, [row]);

    await user.click(screen.getByRole('button', { name: 'Retry research' }));

    expect(
      await screen.findByText(
        'No report — the Routine’s daily run cap or usage limit was reached. Retry to start a new session.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry research' })).toBeInTheDocument();
  });

  it('puts the row back and toasts when the retry is refused', async () => {
    const user = userEvent.setup();
    const row = research(FAILED);
    mockApi.retryResearch.mockRejectedValue(
      new api.ApiError('API POST failed: 409', 409, 'That research is still running.'),
    );
    renderReader(<StoreList />, [row]);

    await user.click(screen.getByRole('button', { name: 'Retry research' }));

    expect(await screen.findByText('That research is still running.')).toBeInTheDocument();
    expect(screen.getByText('no report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry research' })).toBeInTheDocument();
  });

  it('hides Retry research on a deployment with no research set up', () => {
    const row = research({ ...FAILED, research_session_url: SESSION_URL });
    renderReader(<PostRow post={row} now={NOW} />, [row], undefined, { researchConfigured: false });

    expect(screen.queryByRole('button', { name: 'Retry research' })).not.toBeInTheDocument();
    expect(verbRow()).toEqual(['Archive', 'Session']);
  });

  it('answers i with nothing: there is no Send to run', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    renderReader(<PostRow post={research(FAILED)} now={NOW} selected onExit={onExit} />);

    await user.keyboard('i');
    endExit();

    expect(onExit).not.toHaveBeenCalled();
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
  });

  it('archives all the same', async () => {
    const user = userEvent.setup();
    const row = research(FAILED);
    mockApi.patchReaderPost.mockResolvedValue({ ...row, archived_at: '2026-09-18T09:00:00.000Z' });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    endExit();

    await waitFor(() => {
      expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-r', { archived: true });
    });
  });
});

describe('PostRow — a delivered research report', () => {
  it('reads as an ordinary summarised post, under the Research eyebrow with a read time', () => {
    renderReader(<PostRow post={report()} now={NOW} />);

    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Sep 18 · 11 min read')).toBeInTheDocument();
    expect(screen.queryByText(/via Instapaper/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Probably yes if the furnace is near the end of its life.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('researching…')).not.toBeInTheDocument();
    expect(screen.queryByText('no report')).not.toBeInTheDocument();
    expect(screen.queryByText('summarising…')).not.toBeInTheDocument();
    expect(screen.getByTestId('reader-row')).not.toHaveClass('opacity-70');
  });

  it('leaves Session for the overview’s footer once the row has a panel', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={report()} now={NOW} />);

    expect(verbRow()).toEqual(['Send to Instapaper', 'Overview', 'Archive']);
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    const footer = screen.getByRole('link', { name: 'Session' });
    expect(footer).toHaveAttribute('href', SESSION_URL);
    expect(screen.queryByRole('link', { name: 'Original' })).not.toBeInTheDocument();
    expect(verbsIn(screen.getByTestId('reader-row-overview'))).toContain('Re-summarise');
  });

  it('sends its body — no link needed — the way any post is sent, on the button and on i', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = report();
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} selected onExit={onExit} />, [row]);

    expect(sendButton()).toBeEnabled();
    await user.keyboard('i');
    endExit();

    expect(onExit).toHaveBeenCalledWith('p-r');
    await waitFor(() => {
      expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledWith('p-r');
    });
  });

  it('reads a report whose body was swept as having nothing to send', () => {
    renderReader(
      <PostRow post={report({ text_swept_at: '2026-12-29T03:00:00.000Z' })} now={NOW} />,
    );

    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute('title', 'No link and no stored text to send.');
  });

  it('is waiting on its summary, like any post, while the summariser has not reached it', () => {
    renderReader(
      <PostRow
        post={report({ summary_state: 'pending', gist: null, overview: null, summarized_at: null })}
        now={NOW}
      />,
    );

    expect(screen.getByText('summarising…')).toBeInTheDocument();
    expect(
      screen.getByText('The summary is on its way — send it now, or check back in a few minutes.'),
    ).toBeInTheDocument();
    // Sendable at once — the body is here — and Session sits where Original would.
    expect(verbRow()).toEqual(['Send to Instapaper', 'Archive', 'Session']);
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry research' })).not.toBeInTheDocument();
  });

  it('offers Retry summary when its summary failed, and never Retry research', () => {
    renderReader(
      <PostRow
        post={report({ summary_state: 'failed', gist: null, overview: null, last_error: 'no fit' })}
        now={NOW}
      />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Retry summary', 'Archive', 'Session']);
    expect(screen.getByText('summary failed')).toBeInTheDocument();
  });

  it('offers the ordinary wiki checklists for its Novel ideas and Evidence', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={report()} now={NOW} />, [], undefined, { wikiWritable: true });

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeEnabled();
  });

  it('unarchives from the archive like any post', () => {
    renderReader(
      <PostRow post={report({ archived_at: minutesBeforeNow(1) })} now={NOW} variant="archive" />,
    );

    expect(verbRow()).toEqual(['Send to Instapaper', 'Overview', 'Unarchive']);
  });
});

describe('PostRow — a roundup', () => {
  const ROUNDUP = {
    id: 'p-roundup',
    summary_state: 'done',
    summary_kind: 'roundup',
    gist: 'Worth opening for the dexterity benchmark.',
    word_count: 2070,
    model: 'claude-sonnet-5',
    prompt_version: 1,
    summarized_at: '2026-09-16T14:05:00.000Z',
    overview: makeRoundupOverview(),
  } as const;

  it('keeps the gist on the row and Send in its verbs, as an essay does', () => {
    renderReader(<PostRow post={post(ROUNDUP)} now={NOW} />);

    expect(screen.getByText('Worth opening for the dexterity benchmark.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send to Instapaper/ })).toBeInTheDocument();
  });

  it('opens on Highlights, then Links — the send checklist under its own heading', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={post(ROUNDUP)} now={NOW} />);

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    const panel = screen.getByTestId('reader-row-overview');
    const headings = within(panel)
      .getAllByRole('heading')
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Highlights', 'Links']);
    expect(
      within(panel).getByText(
        'Public benchmarks now saturate in a median 14 months, down from 30 in 2022.',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Select all Links' })).toBeInTheDocument();
    expect(within(panel).getByText('DexBench: sim-to-real for folding')).toBeInTheDocument();
    // No essay section, and nothing to pick for the wiki.
    expect(within(panel).queryByText('Novel ideas')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Further reading')).not.toBeInTheDocument();
  });

  it('says so when nothing in the issue stood out, and draws no Links section without links', async () => {
    const user = userEvent.setup();
    renderReader(
      <PostRow
        post={post({ ...ROUNDUP, overview: { highlights: [' '], further_reading: [] } })}
        now={NOW}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    const panel = screen.getByTestId('reader-row-overview');
    expect(within(panel).getByText('Nothing stood out in the issue itself.')).toBeInTheDocument();
    expect(within(panel).queryByText('Links')).not.toBeInTheDocument();
  });

  it('names the kind on the stamp, since each kind’s prompt is versioned apart', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={post(ROUNDUP)} now={NOW} />);

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByText('claude-sonnet-5 · roundup prompt v1 · Sep 16')).toBeInTheDocument();
  });

  it('renders by the kind it was summarised under — an essay overview stamped roundup shows no sections', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={post({ ...ROUNDUP, overview: makeReaderOverview() })} now={NOW} />);

    expect(screen.getByText('Worth opening for the dexterity benchmark.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    const panel = screen.getByTestId('reader-row-overview');
    expect(within(panel).queryAllByRole('heading')).toEqual([]);
    expect(within(panel).getByText(/roundup prompt v1/)).toBeInTheDocument();
  });
});

describe('PostRow — an Alerts post', () => {
  const ALERTS = {
    id: 'p-alerts',
    summary_state: 'done',
    summary_kind: 'alerts',
    canonical_url: 'https://www.patagonia.com/wornwear',
    gist: 'A members-only sale and a trade-in bonus.',
    word_count: 410,
    model: 'claude-sonnet-5',
    prompt_version: 1,
    summarized_at: '2026-09-16T14:05:00.000Z',
    overview: makeAlertsOverview(),
  } as const;

  it('draws one tagged line per finding in the gist’s place', () => {
    renderReader(<PostRow post={post(ALERTS)} now={NOW} />);

    const lines = [...screen.getByTestId('alert-findings').children].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      'Sale40% off used outerwear, members only.',
      'ActionTrade-in credit doubles if you book by Oct 12.',
    ]);
    expect(screen.queryByText('A members-only sale and a trade-in bonus.')).not.toBeInTheDocument();
  });

  it('tags a security finding in the destructive tone and the rest in the alert tone', () => {
    renderReader(
      <PostRow
        post={post({
          ...ALERTS,
          overview: makeAlertsOverview([
            { category: 'security', detail: 'New sign-in from Lisbon.', deadline: null },
            { category: 'change', detail: 'Plan price rises to $12.', deadline: 'Nov 1' },
          ]),
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText('Security')).toHaveClass('text-destructive');
    expect(screen.getByText('Change')).toHaveClass('text-amber-400');
    // A deadline the detail doesn't already say is added after it.
    expect(screen.getByText('Plan price rises to $12. · by Nov 1')).toBeInTheDocument();
  });

  it('has no Send — there is nothing to read later in a sale notice — and i does nothing', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post(ALERTS);
    renderReader(<PostRow post={row} now={NOW} selected onExit={onExit} />, [row]);

    expect(screen.queryByRole('button', { name: /Send to Instapaper/ })).not.toBeInTheDocument();
    await user.keyboard('i');

    expect(onExit).not.toHaveBeenCalled();
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
  });

  it('opens an Overview that holds only the footer: Original, Re-summarise and the stamp', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={post(ALERTS)} now={NOW} />);

    await user.click(screen.getByRole('button', { name: 'Overview' }));

    const panel = screen.getByTestId('reader-row-overview');
    expect(within(panel).queryAllByRole('heading')).toEqual([]);
    expect(within(panel).getByRole('link', { name: /Original/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Re-summarise' })).toBeInTheDocument();
    expect(
      within(panel).getByText('claude-sonnet-5 · alerts prompt v1 · Sep 16'),
    ).toBeInTheDocument();
  });

  it('v toggles that footer panel', async () => {
    const user = userEvent.setup();
    const row = post(ALERTS);
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    await user.keyboard('v');

    expect(screen.getByRole('button', { name: 'Hide overview' })).toBeInTheDocument();
  });

  it('reads "Nothing notable — filed automatically." for a post the tick filed', () => {
    renderReader(
      <PostRow
        post={post({
          ...ALERTS,
          gist: 'Nothing notable',
          overview: makeAlertsOverview([]),
          archived_at: '2026-09-16T14:05:00.000Z',
        })}
        now={NOW}
        variant="archive"
      />,
    );

    expect(screen.getByText('Nothing notable — filed automatically.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing notable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unarchive/ })).toBeInTheDocument();
  });

  it('reads nothing in the gist’s place when its overview fails the Alerts guard', () => {
    renderReader(<PostRow post={post({ ...ALERTS, overview: makeReaderOverview() })} now={NOW} />);

    expect(screen.queryByTestId('alert-findings')).not.toBeInTheDocument();
    expect(screen.queryByText('A members-only sale and a trade-in bonus.')).not.toBeInTheDocument();
    expect(screen.queryByText(/filed automatically/)).not.toBeInTheDocument();
  });

  it('is an ordinary row with Send before it has been summarised as Alerts', () => {
    renderReader(
      <PostRow
        post={post({ ...ALERTS, summary_state: 'pending', gist: null, summary_kind: null })}
        now={NOW}
      />,
    );

    expect(screen.getByRole('button', { name: /Send to Instapaper/ })).toBeInTheDocument();
    expect(screen.getByText(/The summary is on its way/)).toBeInTheDocument();
  });
});
