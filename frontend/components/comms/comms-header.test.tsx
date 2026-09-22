import { screen } from '@testing-library/react';
import * as React from 'react';

import { makeCommAccount, makeCommHealth, makeCommMessage } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { CommsHeader } from './comms-header';

/**
 * The header's whole job is to say whether the number below it can be trusted, so what is
 * pinned here is the DIFFERENCE between quiet and broken — and between a source failing and
 * judgment failing, which look nothing alike and are fixed nothing alike.
 */

const NOW = new Date('2026-09-09T12:00:00.000Z');
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60 * 1000).toISOString();

function renderHeader(properties: Partial<React.ComponentProps<typeof CommsHeader>> = {}) {
  return renderWithProviders(
    <CommsHeader
      accounts={properties.accounts ?? []}
      messages={properties.messages ?? []}
      health={properties.health}
      now={NOW}
      lastClassifiedAt={properties.lastClassifiedAt}
      notLiveSince={properties.notLiveSince}
      loaded={properties.loaded}
    />,
  );
}

describe('CommsHeader', () => {
  it('names the module and what the queue holds', () => {
    renderHeader();

    expect(screen.getByRole('heading', { level: 2, name: 'Comms' })).toBeInTheDocument();
  });

  it('draws one dot per account, each labelled with its state', () => {
    renderHeader({
      accounts: [
        makeCommAccount('personal', { last_seen_at: iso(2) }),
        makeCommAccount('iMessage', { home: 'daemon', last_seen_at: iso(180) }),
      ],
    });

    expect(screen.getByLabelText('personal · live')).toBeInTheDocument();
    expect(screen.getByLabelText('iMessage · stale')).toBeInTheDocument();
  });

  it('says under the dots which source pinged last, and how long ago', () => {
    renderHeader({
      accounts: [
        makeCommAccount('personal', { last_seen_at: iso(9) }),
        makeCommAccount('iMessage', { home: 'daemon', last_seen_at: iso(3) }),
      ],
    });

    expect(screen.getByTestId('last-ping')).toHaveTextContent('Last ping 3m ago · iMessage');
  });

  it('leaves the last-ping line off until some source has ever been polled', () => {
    renderHeader({ accounts: [makeCommAccount('WorkMail', { home: 'daemon' })] });

    expect(screen.queryByTestId('last-ping')).not.toBeInTheDocument();
  });

  it('separates a broken account from a quiet one — a green dot over a dead source is the failure', () => {
    renderHeader({
      accounts: [
        makeCommAccount('RealPlay', {
          last_seen_at: iso(300),
          last_error: 'the refresh token was rejected',
          last_error_at: iso(40),
        }),
      ],
    });

    expect(screen.getByLabelText('RealPlay · erroring')).toBeInTheDocument();
    expect(
      screen.getByText(
        'RealPlay stopped ingesting 40m ago — the refresh token was rejected. This is not quiet, it is broken. Re-authorize.',
      ),
    ).toBeInTheDocument();
  });

  it('explains a stale Mac-polled source as sleep rather than breakage', () => {
    renderHeader({
      accounts: [makeCommAccount('iMessage', { home: 'daemon', last_seen_at: iso(180) })],
    });

    expect(
      screen.getByText(
        "iMessage last synced 3h ago — the Mac is asleep. Anything sent there since won't appear until it wakes.",
      ),
    ).toBeInTheDocument();
  });

  it('explains a stale Worker-polled source as a poll that stopped running', () => {
    renderHeader({
      accounts: [makeCommAccount('personal', { last_seen_at: iso(180) })],
    });

    expect(screen.getByText(/the poll has stopped running/)).toBeInTheDocument();
  });

  it('says so when an account has never been polled at all', () => {
    renderHeader({ accounts: [makeCommAccount('WorkMail', { home: 'daemon' })] });

    expect(screen.getByText(/WorkMail has never synced/)).toBeInTheDocument();
  });

  it('says nothing at all when every account is live', () => {
    renderHeader({ accounts: [makeCommAccount('personal', { last_seen_at: iso(1) })] });

    expect(screen.queryByTestId('account-health-notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('raises the classifier banner when judgment has stalled, above the dots', () => {
    renderHeader({
      accounts: [makeCommAccount('personal', { last_seen_at: iso(1) })],
      health: makeCommHealth({
        last_success_at: iso(200),
        last_error: 'ANTHROPIC_API_KEY missing',
        last_error_at: iso(140),
      }),
    });

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Classifier stalled 2h ago');
    expect(banner).toHaveTextContent(
      'Everything still arriving is still being stored; nothing new is being judged.',
    );
  });

  it('catches a stall the sweep never got far enough to record', () => {
    renderHeader({
      accounts: [makeCommAccount('personal', { last_seen_at: iso(1) })],
      messages: [makeCommMessage('acct-1', { received_at: iso(45), tier: null })],
      health: makeCommHealth({ last_success_at: iso(3) }),
    });

    expect(screen.getByRole('status')).toHaveTextContent('Classifier stalled 45m ago');
  });

  it('says the view is not live, and what it is showing, when it may be behind', () => {
    renderHeader({ notLiveSince: iso(12) });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Not live — this is what was here 12m ago. Anything since may be missing until it refreshes.',
    );
  });

  it('says it could not load, rather than dating a view it never had', () => {
    renderHeader({ loaded: false });

    expect(screen.getByRole('heading', { level: 2, name: 'Comms' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load Comms — retrying.");
  });

  it('shows only the heading and the retry line while unloaded — never partial dots or sentences', () => {
    renderHeader({
      loaded: false,
      accounts: [
        makeCommAccount('RealPlay', {
          last_seen_at: iso(300),
          last_error: 'the refresh token was rejected',
          last_error_at: iso(40),
        }),
      ],
      health: makeCommHealth({
        last_success_at: iso(200),
        last_error: 'ANTHROPIC_API_KEY missing',
        last_error_at: iso(140),
      }),
      notLiveSince: iso(12),
    });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByTestId('account-dots')).not.toBeInTheDocument();
    expect(screen.queryByTestId('last-ping')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-health-notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says nothing about liveness while the view is live', () => {
    renderHeader({ accounts: [makeCommAccount('personal', { last_seen_at: iso(1) })] });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('counts a verdict the server knows of as proof of life, even off the loaded page', () => {
    renderHeader({
      accounts: [makeCommAccount('personal', { last_seen_at: iso(1) })],
      messages: [makeCommMessage('acct-1', { received_at: iso(45), tier: null })],
      health: makeCommHealth({ last_success_at: iso(1) }),
      lastClassifiedAt: iso(2),
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('leaves the banner off while the sweep is keeping up', () => {
    renderHeader({
      accounts: [makeCommAccount('personal', { last_seen_at: iso(1) })],
      messages: [makeCommMessage('acct-1', { received_at: iso(2), tier: null })],
      health: makeCommHealth({ last_success_at: iso(1) }),
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
