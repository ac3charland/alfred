import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  makeReaderOverview,
  makeReaderPostListItem,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { PostRow } from './post-row';
import { renderReader } from './test-helpers';

jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

const NOW = new Date(2026, 8, 18, 9, 0);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  return makeReaderPostListItem(PUBLICATION_ID, overrides);
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

describe('PostRow — Send to Instapaper', () => {
  it('leads the verb row, with its own keycap on the selected row', () => {
    const row = post({ summary_state: 'done', gist: 'a gist', word_count: 900 });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    const send = screen.getByRole('button', { name: /Send to Instapaper/ });
    // First in its own row, which is what "primary verb" means here — compared by position
    // rather than by reading every button on the card, since the card itself is a button too.
    expect(send.parentElement?.firstElementChild).toBe(send);
    expect(within(send).getByText('i')).toBeInTheDocument();
  });

  it('sends the post, archiving it in the same press', async () => {
    const user = userEvent.setup();
    const row = post({ id: 'p-1', canonical_url: 'https://example.test/p/a', word_count: 900 });
    mockApi.sendReaderPostToInstapaper.mockResolvedValue({
      ...row,
      instapaper_sent_at: '2026-09-18T09:00:00.000Z',
      archived_at: '2026-09-18T09:00:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    await user.click(screen.getByRole('button', { name: /Send to Instapaper/ }));
    endExit();

    expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledWith('p-1');
  });

  it('plays the exit collapse on the reading list, telling the list as it starts', async () => {
    // The same animate-then-commit path Archive takes: a successful send archives the post, so
    // the row is leaving either way and the list must not jump under the owner.
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post({ id: 'p-1', canonical_url: 'https://example.test/p/a', word_count: 900 });
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} onExit={onExit} />, [row]);

    await user.click(screen.getByRole('button', { name: /Send to Instapaper/ }));

    expect(onExit).toHaveBeenCalledWith('p-1');
    expect(screen.getByTestId('reader-row-collapse')).toHaveClass('grid-rows-[0fr]');
    // The write waits for the collapse to finish, exactly as the archive verb's does.
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
  });

  it('sends in place from the archive, with no exit and no onExit', async () => {
    const user = userEvent.setup();
    const onExit = jest.fn();
    const row = post({
      id: 'p-1',
      canonical_url: 'https://example.test/p/a',
      word_count: 900,
      archived_at: '2026-09-17T09:00:00.000Z',
    });
    mockApi.sendReaderPostToInstapaper.mockResolvedValue({
      ...row,
      instapaper_sent_at: '2026-09-18T09:00:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} variant="archive" onExit={onExit} />, [row]);

    await user.click(screen.getByRole('button', { name: /Send to Instapaper/ }));

    expect(mockApi.sendReaderPostToInstapaper).toHaveBeenCalledWith('p-1');
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByTestId('reader-row-collapse')).toHaveClass('grid-rows-[1fr]');
  });

  it('is disabled with a title on a deployment with no Instapaper credentials', async () => {
    const user = userEvent.setup();
    const row = post({ canonical_url: 'https://example.test/p/a', word_count: 900 });
    renderReader(<PostRow post={row} now={NOW} selected />, [row], undefined, false);

    const send = screen.getByRole('button', { name: 'Send to Instapaper' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', "Instapaper isn't set up on this deployment.");
    // No keycap either: `i` refuses for the same reason, so a hint would point at nothing.
    expect(within(send).queryByText('i')).not.toBeInTheDocument();

    await user.click(send);
    expect(mockApi.sendReaderPostToInstapaper).not.toHaveBeenCalled();
  });

  it('is disabled with a title for a post with no link and no stored text', () => {
    const row = post({
      canonical_url: null,
      rfc822_message_id: '<a@mail.test>',
      word_count: 900,
      text_swept_at: '2026-09-08T03:00:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    const send = screen.getByRole('button', { name: 'Send to Instapaper' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', 'No link and no stored text to send.');
  });

  it('is disabled for a post that never had a body and has no link', () => {
    const row = post({ canonical_url: null, rfc822_message_id: null, word_count: 0 });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByRole('button', { name: 'Send to Instapaper' })).toBeDisabled();
  });

  it('stays enabled for a swept post that still has a web link', () => {
    // Instapaper can fetch the article itself; the send just arrives without the stored body.
    const row = post({
      canonical_url: 'https://example.test/p/a',
      word_count: 900,
      text_swept_at: '2026-09-08T03:00:00.000Z',
    });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByRole('button', { name: /Send to Instapaper/ })).toBeEnabled();
  });

  it('stays enabled for a link-less post that still has its text', () => {
    // It goes as a private bookmark from source email — the Gmail permalink is never sent.
    const row = post({ canonical_url: null, rfc822_message_id: '<a@mail.test>', word_count: 900 });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByRole('button', { name: /Send to Instapaper/ })).toBeEnabled();
  });

  it('is never disabled by a Gmail-permalink-only link alone', () => {
    // The mailbox fallback is a way for the OWNER to reach the post, not an address Instapaper
    // could fetch — so it is the stored text, not the link, that keeps the verb alive here.
    const row = post({ canonical_url: null, rfc822_message_id: '<a@mail.test>', word_count: 0 });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByRole('button', { name: 'Send to Instapaper' })).toBeDisabled();
  });

  it('shows the in-Instapaper badge once the post has been sent', () => {
    const row = post({ instapaper_sent_at: '2026-09-18T09:00:00.000Z' });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
  });
});

describe('PostRow — Original', () => {
  it('sits in the panel footer when the row has one', async () => {
    const row = post({
      summary_state: 'done',
      gist: 'a gist',
      overview: makeReaderOverview(),
      canonical_url: 'https://example.substack.com/p/a-post',
      model: 'claude-sonnet-5',
      prompt_version: 2,
      summarized_at: '2026-09-16T14:05:00.000Z',
    });
    const user = userEvent.setup();
    renderReader(<PostRow post={row} now={NOW} />, [row]);
    // The panel is inert while collapsed — which is exactly why `o` opens the original itself
    // rather than clicking this anchor.
    await user.click(screen.getByRole('button', { name: 'Overview' }));

    const link = screen.getByRole('link', { name: /Original/ });
    expect(link).toHaveAttribute('href', 'https://example.substack.com/p/a-post');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    // In the footer, beside Re-summarise — not in the verb row, which would then show it twice.
    expect(screen.getByTestId('reader-row-overview')).toContainElement(link);
    expect(screen.getAllByRole('link', { name: /Original/ })).toHaveLength(1);
  });

  it('sits at the end of the verb row when the row has no panel', () => {
    // A failed row has no overview and no stamp, so there is no panel to hold the link — and
    // adding one would put an "Overview" toggle on a row with nothing to disclose.
    const row = post({
      summary_state: 'failed',
      canonical_url: 'https://example.substack.com/p/a-post',
      word_count: 900,
    });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Original/ });
    expect(link).toHaveAttribute('href', 'https://example.substack.com/p/a-post');
    const verbs = screen.getAllByRole('button').map((button) => button.textContent);
    expect(verbs.at(-1)).toContain('Archive');
  });

  it('falls back to the Gmail permalink when there is no canonical URL', () => {
    const row = post({
      summary_state: 'failed',
      canonical_url: null,
      rfc822_message_id: '<import-ai-412@mail.substack.com>',
      word_count: 900,
    });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.getByRole('link', { name: /Original/ })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#search/rfc822msgid:import-ai-412%40mail.substack.com',
    );
  });

  it('is absent entirely when there is nowhere to point', () => {
    // The old disabled "Open" button is gone: a row with no link simply has no way out, and the
    // send verb is what it offers instead.
    const row = post({ summary_state: 'failed', canonical_url: null, rfc822_message_id: null });
    renderReader(<PostRow post={row} now={NOW} />, [row]);

    expect(screen.queryByRole('link', { name: /Original/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('stamps opened on click, without calling preventDefault', () => {
    const row = post({
      id: 'p-1',
      summary_state: 'failed',
      canonical_url: 'https://example.substack.com/p/a-post',
      word_count: 900,
    });
    mockApi.patchReaderPost.mockResolvedValue(row);
    renderReader(<PostRow post={row} now={NOW} />, [row]);
    const link = screen.getByRole('link', { name: /Original/ });

    // A real `click()` rather than a mocked one — the assertion below is that navigation was
    // never prevented, which a mocked `.click()` would make meaningless. jsdom's own default
    // action for an anchor click is unimplemented and logs rather than throws.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, event);

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { opened: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it('wears the o keycap on the selected row, where it is visible', () => {
    const row = post({
      summary_state: 'failed',
      canonical_url: 'https://example.substack.com/p/a-post',
      word_count: 900,
    });
    renderReader(<PostRow post={row} now={NOW} selected />, [row]);

    expect(
      within(screen.getByRole('link', { name: /Original/ })).getByText('o'),
    ).toBeInTheDocument();
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
    ['Overview', post({ ...ROW, summary_state: 'done', overview: makeReaderOverview() })],
    ['Retry summary', post({ ...ROW, summary_state: 'failed' })],
    ['Archive', post({ ...ROW, summary_state: 'done', overview: makeReaderOverview() })],
  ])('%s', async (name, row) => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    mockApi.sendReaderPostToInstapaper.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} onSelect={onSelect} />, [row]);

    await user.click(screen.getByRole('button', { name: new RegExp(name) }));

    expect(onSelect).toHaveBeenCalledWith('p-1');
  });

  it('Original, from the end of a panel-less verb row', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const row = post({ ...ROW, summary_state: 'failed' });
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    renderReader(<PostRow post={row} now={NOW} onSelect={onSelect} />, [row]);

    await user.click(screen.getByRole('link', { name: /Original/ }));

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
