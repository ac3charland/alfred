import { fireEvent, screen } from '@testing-library/react';
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
