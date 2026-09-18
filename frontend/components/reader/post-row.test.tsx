import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeReaderOverview, makeReaderPost, resetReaderFixtureClock } from '@/lib/reader/fixtures';
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
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, overrides);
  return listItem;
}

/** jsdom plays no CSS transitions, so fire the exit wrapper's own transitionend by hand. */
function endExit(): void {
  const wrapper = screen.getByTestId('reader-row-collapse');
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'grid-template-rows' });
  fireEvent(wrapper, event);
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
      screen.getByText('The summary is on its way — open it now, or check back in a few minutes.'),
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
        "No summary — the model's output didn't fit the schema three times. The post is still here; open it or archive it.",
      ),
    ).toBeInTheDocument();
  });

  it('failed: falls back to a generic clause when last_error is absent', () => {
    renderReader(<PostRow post={post({ summary_state: 'failed', last_error: null })} now={NOW} />);

    expect(
      screen.getByText(
        "No summary — the model couldn't produce one. The post is still here; open it or archive it.",
      ),
    ).toBeInTheDocument();
  });

  it('refused: the fixed placeholder', () => {
    renderReader(<PostRow post={post({ summary_state: 'refused' })} now={NOW} />);

    expect(screen.getByText('summary refused')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No summary — the model declined to summarise this one. The post is still here; open it or archive it.',
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

describe('PostRow — Open', () => {
  it('links to the canonical URL when there is one', () => {
    renderReader(
      <PostRow post={post({ canonical_url: 'https://example.substack.com/p/a-post' })} now={NOW} />,
    );

    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('href', 'https://example.substack.com/p/a-post');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('falls back to the Gmail permalink when there is no canonical URL', () => {
    renderReader(
      <PostRow
        post={post({ canonical_url: null, rfc822_message_id: '<import-ai-412@mail.substack.com>' })}
        now={NOW}
      />,
    );

    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#search/rfc822msgid:import-ai-412%40mail.substack.com',
    );
  });

  it('is disabled with a title when neither exists', () => {
    renderReader(
      <PostRow post={post({ canonical_url: null, rfc822_message_id: null })} now={NOW} />,
    );

    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'No link in the post and no Message-ID captured for it.',
    );
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
    const link = screen.getByRole('link', { name: 'Open' });

    // A real `click()` rather than a mocked one — the assertion below is that navigation was
    // never prevented, which a mocked `.click()` (message-row's keyboard-open test pattern)
    // would make meaningless. jsdom's own default action for an anchor click is unimplemented
    // and logs rather than throws, so this is safe to run for real.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, event);

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { opened: true });
    expect(event.defaultPrevented).toBe(false);
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
      screen.getByText('The summary is on its way — open it now, or check back in a few minutes.'),
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
        "No summary — the model declined to summarise this one. Its text was swept on Sep 8, so it can't be retried; open it or archive it.",
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
        'No summary — no readable body. The post is still here; open it or archive it.',
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
