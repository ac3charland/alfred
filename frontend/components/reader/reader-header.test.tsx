import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { makeCommAccount } from '@/lib/comms/fixtures';
import {
  NO_READER_HEALTH,
  READER_HEALTH_FIXTURE_NOW,
  makeReaderHealth,
  makeReaderPost,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type {
  CommAccount,
  ReaderHealth,
  ReaderHealthSnapshot,
  ReaderPostListItem,
} from '@/lib/types';

import { ReaderHeader } from './reader-header';

const NOW = new Date(READER_HEALTH_FIXTURE_NOW);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const MINUTE_MS = 60 * 1000;

/** An instant `minutes` before the pinned now, as the columns store it. */
function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

const LIVE_ACCOUNT: CommAccount = makeCommAccount('Personal', {
  key: 'gmail-personal',
  last_seen_at: ago(1),
});

/** A health row with nothing recorded against it. */
function liveHealth(overrides: Partial<ReaderHealth> = {}): ReaderHealth {
  return makeReaderHealth('live', overrides, NOW);
}

/** A claimed post the tick should have summarised `minutes` ago. */
function waiting(minutes: number): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, {
    summary_state: 'pending',
    word_count: 1200,
    created_at: ago(minutes),
  });
  return listItem;
}

function renderHeader(snapshot: ReaderHealthSnapshot, posts: ReaderPostListItem[] = []) {
  return render(
    <ReaderHeader snapshot={snapshot} posts={posts} now={NOW} description="3 to read" />,
  );
}

beforeEach(() => {
  resetReaderFixtureClock();
});

describe('ReaderHeader — the heading', () => {
  it('keeps the list’s own name and count line beside the health block', () => {
    renderHeader({ health: liveHealth(), account: LIVE_ACCOUNT });

    expect(screen.getByText('Reader')).toBeInTheDocument();
    expect(screen.getByText('3 to read')).toBeInTheDocument();
  });
});

describe('ReaderHeader — the dots', () => {
  it('reads both sources as live, and says nothing more', () => {
    renderHeader({ health: liveHealth(), account: LIVE_ACCOUNT });

    // The summariser names its own state, so the line beside its dot carries the claim; the
    // mailbox takes the tone words, and its dot is what says them.
    expect(screen.getByText('summariser · live')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Gmail \(personal\) ·/ })).toBeInTheDocument();
    expect(screen.queryByTestId('reader-health-notes')).not.toBeInTheDocument();
  });

  it('names the summariser stalled, in the label rather than in the colour', () => {
    renderHeader({ health: makeReaderHealth('stalled', {}, NOW), account: LIVE_ACCOUNT });

    // The summariser's own word, not the dot's tone word — amber covers two states here, and the
    // line beside the dot is where it is both drawn and announced.
    expect(screen.getByText('summariser · stalled')).toBeInTheDocument();
  });

  it('names a summariser that has never run — an unstamped row is not a stall', () => {
    renderHeader({ health: makeReaderHealth('never', {}, NOW), account: LIVE_ACCOUNT }, [
      waiting(90),
    ]);

    expect(screen.getByText('summariser · never ran')).toBeInTheDocument();
  });

  it('reads a database with no health row at all the same way', () => {
    renderHeader({ ...NO_READER_HEALTH, account: LIVE_ACCOUNT }, [waiting(90)]);

    expect(screen.getByText('summariser · never ran')).toBeInTheDocument();
  });

  it('carries the mailbox state and how long it has been silent', () => {
    const account = { ...LIVE_ACCOUNT, last_seen_at: ago(360) };
    renderHeader({ health: liveHealth(), account });

    expect(screen.getByRole('img', { name: 'Gmail (personal) · stale' })).toBeInTheDocument();
    expect(screen.getByText('· 6h ago')).toBeInTheDocument();
  });

  it('quotes the refusal in the dot’s title', () => {
    const account = {
      ...LIVE_ACCOUNT,
      last_seen_at: ago(360),
      last_error_at: ago(120),
      last_error: 'invalid_grant',
    };
    renderHeader({ health: liveHealth(), account });

    expect(screen.getByTitle('Gmail (personal) — invalid_grant (2h ago)')).toBeInTheDocument();
  });

  it('draws no mailbox dot when no account was ever provisioned', () => {
    renderHeader({ health: liveHealth(), account: undefined });

    expect(screen.queryByRole('img', { name: /^Gmail/ })).not.toBeInTheDocument();
    expect(screen.getByText(/^summariser/)).toBeInTheDocument();
  });
});

describe('ReaderHeader — the sentences', () => {
  it('says when the summariser stopped, why, and what still happens', () => {
    const health = makeReaderHealth(
      'stalled',
      { last_error_at: ago(48), last_error: 'ANTHROPIC_API_KEY is not set' },
      NOW,
    );
    renderHeader({ health, account: LIVE_ACCOUNT });

    expect(
      screen.getByText(
        'Summariser stalled 48m ago — ANTHROPIC_API_KEY is not set. Posts are still arriving; none are being summarised.',
      ),
    ).toBeInTheDocument();
  });

  it('quotes the pre-flight failure the tick stamped before it could record a run', () => {
    // No run and an error is a misconfigured deploy, not a cron that never fired — the sentence
    // owes the owner the words the tick wrote rather than pointing them at the schedule.
    const health = makeReaderHealth(
      'preflight',
      { last_error_at: ago(2), last_error: 'ANTHROPIC_API_KEY is not set' },
      NOW,
    );
    renderHeader({ health, account: LIVE_ACCOUNT });

    expect(
      screen.getByText(
        'Summariser stalled 2m ago — ANTHROPIC_API_KEY is not set. Posts are still arriving; none are being summarised.',
      ),
    ).toBeInTheDocument();
    // The dot's title is the tick's own quoted words, so hovering it cannot contradict the line.
    expect(screen.getByTitle('ANTHROPIC_API_KEY is not set (2m ago)')).toBeInTheDocument();
  });

  it('blames the silence itself when the tick is running but nothing has been summarised', () => {
    const health = liveHealth({ last_success_at: ago(120) });
    renderHeader({ health, account: LIVE_ACCOUNT }, [waiting(90)]);

    expect(
      screen.getByText(
        'Summariser stalled 1h ago — no summary has landed since. Posts are still arriving; none are being summarised.',
      ),
    ).toBeInTheDocument();
    // The dot's title is the same silence, so hovering it cannot contradict the line beneath.
    expect(screen.getByTitle('no summary has landed since (1h ago)')).toBeInTheDocument();
  });

  it('blames the cron itself when the tick has stopped running and recorded nothing', () => {
    const health = liveHealth({ last_run_at: ago(20), last_success_at: ago(20) });
    renderHeader({ health, account: LIVE_ACCOUNT });

    expect(
      screen.getByText(
        'Summariser stalled 20m ago — the tick has stopped running. Posts are still arriving; none are being summarised.',
      ),
    ).toBeInTheDocument();
    // The dot's title is the same cause, so hovering it cannot contradict the line beneath.
    expect(screen.getByTitle('the tick has stopped running (20m ago)')).toBeInTheDocument();
  });

  it('sends the owner to the cron when the summariser has never run', () => {
    renderHeader({ health: makeReaderHealth('never', {}, NOW), account: undefined });

    expect(
      screen.getByText("The summariser has never run — check the Worker's cron."),
    ).toBeInTheDocument();
  });

  it('says a refused mailbox needs re-authorizing, in red', () => {
    const account = {
      ...LIVE_ACCOUNT,
      last_seen_at: ago(360),
      last_error_at: ago(120),
      last_error: 'invalid_grant',
    };
    renderHeader({ health: liveHealth(), account });

    const sentence = screen.getByText(
      'Gmail (personal) stopped ingesting 2h ago — invalid_grant. Nothing new reaches the Reader until it is re-authorized.',
    );
    expect(sentence).toHaveClass('text-accent-red');
  });

  it('says a silent mailbox has stopped polling, in amber', () => {
    renderHeader({ health: liveHealth(), account: { ...LIVE_ACCOUNT, last_seen_at: ago(360) } });

    const sentence = screen.getByText(
      'Gmail (personal) last synced 6h ago — the poll has stopped running. Nothing new reaches the Reader until it starts again.',
    );
    expect(sentence).toHaveClass('text-accent-amber');
  });

  it('says both when both are unhealthy — the dots keep the suppressed banner visible', () => {
    const health = makeReaderHealth('stalled', { last_error_at: ago(48) }, NOW);
    renderHeader({ health, account: { ...LIVE_ACCOUNT, last_seen_at: ago(360) } });

    expect(screen.getByTestId('reader-health-notes').childElementCount).toBe(2);
  });
});
