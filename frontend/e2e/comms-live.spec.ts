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
  await page.goto('/comms');

  const today = page.getByRole('region', { name: 'Today' });
  await expect(today.getByText('Lunch Thursday?')).toBeHidden();

  await waitForRealtimeJoin(page, 'comm_messages');
  await pushRowUpdate(page, 'comm_messages', { ...SHELVED, tier: 'today' });

  await expect(today.getByText('Lunch Thursday?')).toBeVisible();
});

test('the last-ping line under the dots follows a poll as it lands', async ({ page, seed }) => {
  await seed({ commAccounts: [PERSONAL] });
  await installRealtimeStub(page);
  await page.goto('/comms');

  const ping = page.getByTestId('last-ping');
  await expect(ping).toHaveText('Last ping 2h ago · personal');

  await waitForRealtimeJoin(page, 'comm_accounts');
  await pushRowUpdate(page, 'comm_accounts', {
    ...PERSONAL,
    last_seen_at: new Date().toISOString(),
  });

  await expect(ping).toHaveText('Last ping just now · personal');
});
