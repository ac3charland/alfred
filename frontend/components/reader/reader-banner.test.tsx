import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { makeCommAccount } from '@/lib/comms/fixtures';
import { READER_HEALTH_FIXTURE_NOW } from '@/lib/reader/fixtures';

import { ReaderBanner } from './reader-banner';

const NOW = new Date(READER_HEALTH_FIXTURE_NOW);

/** An instant `hours` before the pinned now, as the columns store it. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

const ACCOUNT = makeCommAccount('Personal', { key: 'gmail-personal' });

describe('ReaderBanner — the dead mailbox', () => {
  it('quotes the refusal, says what still works, and points at the fix', () => {
    render(
      <ReaderBanner
        banner={{
          kind: 'gmail',
          state: 'erroring',
          account: {
            ...ACCOUNT,
            last_seen_at: hoursAgo(6),
            last_error_at: hoursAgo(2),
            last_error: 'invalid_grant',
          },
        }}
        now={NOW}
      />,
    );

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Gmail is not delivering.');
    expect(banner).toHaveTextContent(
      'The personal mailbox stopped polling 2h ago (invalid_grant).',
    );
    expect(banner).toHaveTextContent(
      'Posts already here are still summarised; nothing new arrives until it is re-authorized — see the Comms header.',
    );
  });

  it('wears the red tone and the mail glyph — the one state that needs a person', () => {
    render(
      <ReaderBanner banner={{ kind: 'gmail', state: 'erroring', account: ACCOUNT }} now={NOW} />,
    );

    expect(screen.getByRole('status')).toHaveClass('border-accent-red/50', 'glow-red');
  });

  it('measures a silent mailbox by its last sync rather than by an error it never recorded', () => {
    render(
      <ReaderBanner
        banner={{
          kind: 'gmail',
          state: 'stale',
          account: { ...ACCOUNT, last_seen_at: hoursAgo(9) },
        }}
        now={NOW}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'The personal mailbox last synced 9h ago; the poll has stopped running.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('until it starts again');
  });

  it('says so plainly when the mailbox has never synced at all', () => {
    render(<ReaderBanner banner={{ kind: 'gmail', state: 'stale', account: ACCOUNT }} now={NOW} />);

    expect(screen.getByRole('status')).toHaveTextContent('The personal mailbox has never synced;');
  });
});

describe('ReaderBanner — the stalled summariser', () => {
  it('dates the stall and quotes what the tick recorded', () => {
    render(
      <ReaderBanner
        banner={{
          kind: 'stalled',
          since: new Date(NOW.getTime() - 48 * 60 * 1000).toISOString(),
          error: 'ANTHROPIC_API_KEY is not set',
        }}
        now={NOW}
      />,
    );

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Summariser stalled 48m ago');
    expect(banner).toHaveTextContent('— ANTHROPIC_API_KEY is not set.');
    expect(banner).toHaveTextContent(
      'Everything still arriving is still stored with its title and link; nothing new is being summarised.',
    );
    expect(banner).toHaveClass('border-accent-amber/50', 'glow-amber');
  });

  it('says what it can when the stall was read off the waiting posts and nothing was recorded', () => {
    render(
      <ReaderBanner banner={{ kind: 'stalled', since: hoursAgo(3), error: null }} now={NOW} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Summariser stalled 3h ago — no summary has landed since.',
    );
  });
});

describe('ReaderBanner — the daily ceiling', () => {
  it('names the cap the tick enforced and how many posts are held by it', () => {
    render(<ReaderBanner banner={{ kind: 'ceiling', cap: 30, waiting: 4 }} now={NOW} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Daily summary ceiling reached (30)');
    expect(banner).toHaveTextContent('— 4 claimed posts wait for tomorrow.');
    expect(banner).toHaveTextContent(
      'Their titles and links are in the list; their summaries land after the UTC day rolls over.',
    );
    expect(banner).toHaveClass('border-accent-amber/50', 'glow-amber');
  });

  it('counts one post in the singular', () => {
    render(<ReaderBanner banner={{ kind: 'ceiling', cap: 30, waiting: 1 }} now={NOW} />);

    expect(screen.getByRole('status')).toHaveTextContent('— 1 claimed post waits for tomorrow.');
  });

  it('is still informative when the budget is spent and nothing is queued behind it', () => {
    render(<ReaderBanner banner={{ kind: 'ceiling', cap: 30, waiting: 0 }} now={NOW} />);

    expect(screen.getByRole('status')).toHaveTextContent('— nothing is waiting on it.');
  });
});
