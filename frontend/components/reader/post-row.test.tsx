import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderOverview, makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
import { stableSorted } from '@/lib/sort';
import { useArchivedPosts, useReaderPosts } from '@/lib/stores/reader-store';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

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
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, html: _html, ...listItem } = makeReaderPost(PUBLICATION_ID, overrides);
  return listItem;
}

/** Render on a deployment with no Instapaper credentials — the Work instance, local dev. */
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
    expect(screen.getByText('Sep 16 · 14 min read')).toBeInTheDocument();
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

describe('PostRow — Novel ideas and the wiki', () => {
  const IDEAS = ['Idea one', 'Idea two', 'Idea three'];
  const WIKI_POST_ID = '22222222-2222-4222-8222-222222222222';
  const withIdeas = (sent: string[] = []) =>
    post({
      id: WIKI_POST_ID,
      summary_state: 'done',
      gist: 'a gist',
      overview: makeReaderOverview({ novel_ideas: IDEAS }),
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
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to wiki/ })).not.toBeInTheDocument();
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

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send all to wiki' })).toBeInTheDocument();
  });

  it('drops the ticks when the overview is collapsed', async () => {
    const user = userEvent.setup();
    renderReader(<PostRow post={withIdeas()} now={NOW} />, [withIdeas()], undefined, {
      wikiWritable: true,
    });
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('checkbox', { name: 'Idea two' }));

    await user.click(screen.getByRole('button', { name: 'Hide overview' }));
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    expect(screen.getByRole('checkbox', { name: 'Idea two' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByRole('group', { name: 'Selected ideas' })).not.toBeInTheDocument();
  });

  it('holds every control while a send started before a collapse is still in the air', async () => {
    const user = userEvent.setup();
    let settle!: (row: ReaderPostListItem) => void;
    mockApi.sendReaderIdeasToWiki.mockReturnValue(
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
    const sendAll = screen.getByRole('button', { name: 'Send all to wiki' });
    expect(sendAll).toBeDisabled();
    await user.click(sendAll);
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(1);

    settle(withIdeas(['Idea two']));
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Idea two' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Idea one' })).toBeEnabled();
  });

  it('lands a send whose row was collapsed mid-flight, and reads it sent on reopening', async () => {
    const user = userEvent.setup();
    let settle!: (row: ReaderPostListItem) => void;
    mockApi.sendReaderIdeasToWiki.mockReturnValue(
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
