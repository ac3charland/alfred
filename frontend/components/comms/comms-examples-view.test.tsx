import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as apiClient from '@/lib/api-client';
import { makeCommAccount, makeCommCorrection, resetCommFixtureClock } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';
import type { CommAccount, CommCorrection } from '@/lib/types';

import { CommsExamplesView } from './comms-examples-view';
import { PRUNED_CARD } from './settings.styles';

jest.mock('@/lib/api-client');

const mockPruneExample = jest.mocked(apiClient.pruneCommExample);
const mockPurge = jest.mocked(apiClient.purgeComms);

const MESSAGE_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70';

let TIER_CHANGE: CommCorrection;
let DEMOTION: CommCorrection;
let ACCOUNT: CommAccount;

beforeEach(() => {
  resetCommFixtureClock();
  ACCOUNT = makeCommAccount('personal');
  TIER_CHANGE = makeCommCorrection({
    account_label: 'personal',
    sender_name: 'Dana Whitfield',
    subject: 'Thursday',
    body_excerpt: 'Are we still on for Thursday?',
    model_tier: 'whenever',
    chosen_tier: 'asap',
    kind: 'tier_change',
    created_version: 2,
  });
  DEMOTION = makeCommCorrection({
    account_label: 'workmail',
    sender_handle: 'noreply@vendor.example',
    subject: 'Your receipt',
    body_excerpt: 'Thanks for your order.',
    model_tier: null,
    chosen_tier: 'fyi',
    kind: 'nothing_to_answer',
    created_version: 1,
    pruned_version: 4,
    pruned_at: '2026-02-01T09:00:00.000Z',
  });
});

function renderView(corrections: CommCorrection[], accounts: CommAccount[] = []) {
  return renderWithProviders(<CommsExamplesView />, {
    commsSettings: { corrections },
    comms: { accounts },
  });
}

describe('CommsExamplesView', () => {
  it('says where corrections come from when there are none — and still offers the purge', () => {
    renderView([]);
    expect(screen.getByText('No corrections yet.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'What to purge' })).toBeInTheDocument();
  });

  it('states the set version every verdict is stamped with, derived from the rows in hand', () => {
    renderView([TIER_CHANGE, DEMOTION]);
    // The newest number sits on the PRUNED row — a prune bumps the set exactly as an insert does.
    expect(screen.getByText('Example set v4')).toBeInTheDocument();
  });

  it('shows the correction as a move, with who it came from and through which account', () => {
    renderView([TIER_CHANGE]);

    expect(screen.getByText(/Dana Whitfield/)).toBeInTheDocument();
    expect(screen.getByText(/personal/)).toBeInTheDocument();
    expect(screen.getByText('Are we still on for Thursday?')).toBeInTheDocument();
    expect(screen.getByText('Whenever')).toBeInTheDocument();
    expect(screen.getByText('ASAP')).toBeInTheDocument();
    expect(screen.getByText('Tier change')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('says a row with no verdict behind it was unjudged rather than inventing a guess', () => {
    renderView([DEMOTION]);
    expect(screen.getByText('unjudged')).toBeInTheDocument();
    expect(screen.getByText('Nothing to answer')).toBeInTheDocument();
  });

  it('mutes a pruned example and stamps the version it left the set at', () => {
    renderView([DEMOTION]);
    expect(screen.getByRole('listitem')).toHaveClass(PRUNED_CARD);
    expect(screen.getByText('pruned v4')).toBeInTheDocument();
  });

  it('says so, rather than showing nothing, once a purge has blanked the text', () => {
    const purged = makeCommCorrection({ body_excerpt: null, purged_at: '2026-03-01T00:00:00Z' });
    renderView([purged]);
    expect(screen.getByText('Purged — the message and its text are gone.')).toBeInTheDocument();
  });

  it('prunes an example and shows the set version the trigger stamped', async () => {
    const user = userEvent.setup();
    mockPruneExample.mockResolvedValue({
      ...TIER_CHANGE,
      pruned_at: '2026-02-02T09:00:00.000Z',
      pruned_version: 5,
    });
    renderView([TIER_CHANGE]);

    await user.click(screen.getByRole('button', { name: 'Prune' }));

    expect(mockPruneExample).toHaveBeenCalledWith(TIER_CHANGE.id, true);
    expect(await screen.findByText('pruned v5')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveClass(PRUNED_CARD);
  });

  it('restores a pruned example, clearing the stamp so it reads as in the set again', async () => {
    const user = userEvent.setup();
    mockPruneExample.mockResolvedValue({ ...DEMOTION, pruned_at: null, pruned_version: null });
    renderView([DEMOTION]);

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(mockPruneExample).toHaveBeenCalledWith(DEMOTION.id, false);
    expect(await screen.findByRole('button', { name: 'Prune' })).toBeInTheDocument();
    expect(screen.queryByText('pruned v4')).not.toBeInTheDocument();
  });
});

describe('the purge', () => {
  it('will not fire until a selector is filled in — a bodiless purge is the whole mirror', () => {
    renderView([TIER_CHANGE]);
    expect(screen.getByRole('button', { name: 'Purge' })).toBeDisabled();
  });

  it('purges one message through a confirm that says what it does and does not touch', async () => {
    const user = userEvent.setup();
    mockPurge.mockResolvedValue({ purged: 1 });
    renderView([TIER_CHANGE]);

    await user.click(screen.getByRole('button', { name: 'One message' }));
    await user.type(screen.getByLabelText('Message id to purge'), MESSAGE_ID);
    await user.click(screen.getByRole('button', { name: 'Purge' }));

    expect(
      await screen.findByText(
        'This deletes the messages from alfred and blanks their example text. Nothing is touched in Gmail or Messages.',
      ),
    ).toBeInTheDocument();

    // Radix hides the page behind the modal, so the only reachable "Purge" is the confirm's.
    const dialog = screen.getByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Purge' }));

    expect(mockPurge).toHaveBeenCalledWith({ message_id: MESSAGE_ID });
    expect(dialog).not.toBeInTheDocument();
    expect(await screen.findByText('Purged 1 message')).toBeInTheDocument();
  });

  it('sends a date selector as an instant, which is what the API takes', async () => {
    const user = userEvent.setup();
    mockPurge.mockResolvedValue({ purged: 12 });
    renderView([TIER_CHANGE]);

    await user.type(screen.getByLabelText('Purge everything before'), '2026-06-01');
    await user.click(screen.getByRole('button', { name: 'Purge' }));
    await user.click(screen.getByRole('button', { name: 'Purge' }));

    expect(mockPurge).toHaveBeenCalledWith({ before: '2026-06-01T00:00:00.000Z' });
    expect(await screen.findByText('Purged 12 messages')).toBeInTheDocument();
  });

  it('offers the accounts the queue knows about', async () => {
    const user = userEvent.setup();
    mockPurge.mockResolvedValue({ purged: 3 });
    renderView([TIER_CHANGE], [ACCOUNT]);

    await user.click(screen.getByRole('button', { name: 'One account' }));
    await user.click(screen.getByRole('button', { name: 'Account to purge' }));
    await user.click(await screen.findByRole('button', { name: 'personal' }));
    await user.click(screen.getByRole('button', { name: 'Purge' }));
    await user.click(screen.getByRole('button', { name: 'Purge' }));

    expect(mockPurge).toHaveBeenCalledWith({ account_id: ACCOUNT.id });
  });
});
