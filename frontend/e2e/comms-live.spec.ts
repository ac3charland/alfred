import type { Page } from '@playwright/test';

import type { CommsSeed } from '@/lib/types';

import { makeCommAccount, makeCommMessage } from './support/constants';
import { expect, test } from './support/fixtures';
import {
  installRealtimeStub,
  pushRowUpdate,
  realtimeJoinToken,
  waitForRealtimeJoin,
} from './support/realtime';

/**
 * ALF-258 — the Comms queue updates itself while it is open.
 *
 * Every Comms write comes from somewhere other than this tab (the pollers, the classifier sweep),
 * so the queue is only ever as fresh as its realtime channels. A channel that joins before the
 * browser client has read the session carries no token, the server subscribes it as `anon`, and
 * RLS delivers it nothing — a queue that looks live and never moves. These drive the real client
 * against a faked socket (see `support/realtime.ts`), so what they check is the frame it sends.
 */

const COMMS_TABLES = ['comm_messages', 'comm_accounts', 'comm_classifier_health', 'comm_verdicts'];

const PERSONAL = makeCommAccount('personal', {
  id: '11111111-1111-4111-8111-111111111111',
  // Mid-hour, so the clock's 30s snap can't tip "2h" into "1h".
  last_seen_at: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
});

const SHELVED = makeCommMessage(PERSONAL.id, {
  id: '22222222-2222-4222-8222-222222222222',
  tier: 'fyi',
  judged_by: 'model',
  sender_name: 'Dana W.',
  subject: 'Lunch Thursday?',
  ask: 'Wants to know if Thursday lunch works.',
});

/** What a tab coming back to the front fires. */
async function returnToTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** The next snapshot re-read the view makes — what it would replace a pushed row with. */
async function nextSnapshot(page: Page): Promise<CommsSeed> {
  const response = await page.waitForResponse((candidate) =>
    candidate.url().includes('/api/comms/snapshot'),
  );
  return (await response.json()) as CommsSeed;
}

test('every Comms channel joins as the signed-in user, never anon', async ({ page, seed }) => {
  await seed({ commAccounts: [PERSONAL] });
  await installRealtimeStub(page);
  await page.goto('/comms');

  for (const table of COMMS_TABLES) {
    await waitForRealtimeJoin(page, table);
    const token = await realtimeJoinToken(page, table);
    expect(token, `${table} joined with no session token`).toBeDefined();
    expect(token).not.toBe('sb_publishable_mock');
  }
});

test('a row the classifier re-tiers moves into the open queue without a reload', async ({
  page,
  seed,
}) => {
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED] });
  await installRealtimeStub(page);
  const joined = nextSnapshot(page);
  await page.goto('/comms');

  const today = page.getByRole('region', { name: 'Today' });
  await expect(today.getByText('Lunch Thursday?')).toBeHidden();

  await waitForRealtimeJoin(page, 'comm_messages');
  await joined;
  // The push reports a write, so the backend holds it too — or the re-read after it reverts it.
  const retiered = { ...SHELVED, tier: 'today' as const };
  await seed({ commAccounts: [PERSONAL], commMessages: [retiered] });
  const settled = nextSnapshot(page);
  await pushRowUpdate(page, 'comm_messages', retiered);

  await expect(today.getByText('Lunch Thursday?')).toBeVisible();
  // The counts are re-read once the burst settles; the row stays where the push put it.
  const { messages } = await settled;
  expect(messages).toContainEqual(expect.objectContaining({ id: SHELVED.id, tier: 'today' }));
  await expect(today.getByText('Lunch Thursday?')).toBeVisible();
});

test('the last-ping line under the dots follows a poll as it lands', async ({ page, seed }) => {
  await seed({ commAccounts: [PERSONAL] });
  await installRealtimeStub(page);
  const joined = nextSnapshot(page);
  await page.goto('/comms');

  const ping = page.getByTestId('last-ping');
  await expect(ping).toHaveText('Last ping 2h ago · personal');

  await waitForRealtimeJoin(page, 'comm_accounts');
  await joined;
  const polled = { ...PERSONAL, last_seen_at: new Date().toISOString() };
  await seed({ commAccounts: [polled] });
  await pushRowUpdate(page, 'comm_accounts', polled);

  await expect(ping).toHaveText('Last ping just now · personal');
  // A re-read after the push agrees with it rather than reverting it.
  const reread = nextSnapshot(page);
  await returnToTab(page);
  const { accounts } = await reread;
  expect(accounts).toContainEqual(
    expect.objectContaining({ id: PERSONAL.id, last_seen_at: polled.last_seen_at }),
  );
  await expect(ping).toHaveText('Last ping just now · personal');
});

/**
 * The other half of "trustworthy": the socket can't replay what it missed, so the view re-reads
 * whenever it may have missed something. These write to the backend with NO realtime push — the
 * change the stream dropped — and check the view catches up anyway, or says it can't.
 */

const ARRIVED = makeCommMessage(PERSONAL.id, {
  id: '33333333-3333-4333-8333-333333333333',
  tier: 'asap',
  judged_by: 'model',
  sender_name: 'Priya R.',
  subject: 'Contract',
  ask: 'Needs the contract signed before noon.',
});

test('a message that landed while the tab was away is there when it comes back', async ({
  page,
  seed,
}) => {
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED] });
  await installRealtimeStub(page);
  const joined = nextSnapshot(page);
  await page.goto('/comms');
  await waitForRealtimeJoin(page, 'comm_messages');
  // The read the join makes has landed, so only the return's re-read can bring ARRIVED in.
  await joined;
  const asap = page.getByRole('region', { name: 'ASAP' });
  await expect(asap.getByText('Needs the contract signed before noon.')).toBeHidden();

  // Written while the socket was down: nothing is pushed for it.
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED, ARRIVED] });
  await returnToTab(page);

  await expect(asap.getByText('Needs the contract signed before noon.')).toBeVisible();
});

test('says it is not live while it cannot re-read, and stops once it can', async ({
  page,
  seed,
}) => {
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED] });
  await installRealtimeStub(page);
  const joined = nextSnapshot(page);
  await page.goto('/comms');
  await waitForRealtimeJoin(page, 'comm_messages');
  await joined;
  // Scoped by text: Next's own route announcer is an `alert` too.
  const notLive = page.getByRole('alert').filter({ hasText: 'Not live' });
  await expect(notLive).toBeHidden();

  await page.route('**/api/comms/snapshot**', (route) => route.abort());
  await returnToTab(page);
  await expect(notLive).toHaveText(/^Not live — this is what was here/);

  // Joined throughout, so the next read that lands makes it live again.
  await page.unroute('**/api/comms/snapshot**');
  await returnToTab(page);
  await expect(notLive).toBeHidden();
});

test('the shelf loads a page at a time, counting all of it', async ({ page, seed }) => {
  const shelf = Array.from({ length: 60 }, (_unused, index) =>
    makeCommMessage(PERSONAL.id, {
      tier: 'fyi',
      judged_by: 'model',
      subject: `Receipt ${String(index + 1)}`,
      received_at: new Date(Date.now() - (index + 1) * 60 * 1000).toISOString(),
    }),
  );
  await seed({ commAccounts: [PERSONAL], commMessages: shelf });
  await page.goto('/comms');

  await page.getByRole('button', { name: /FYI · 60 messages/ }).click();
  await expect(page.getByTestId('comms-row')).toHaveCount(50);

  await page.getByRole('button', { name: 'Show more (10 older)' }).click();
  await expect(page.getByTestId('comms-row')).toHaveCount(60);
  await expect(page.getByRole('button', { name: /Show more/ })).toBeHidden();
});
