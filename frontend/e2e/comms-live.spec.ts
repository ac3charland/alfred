import type { Page } from '@playwright/test';

import { COMMS_LIVE_WINDOW_MS, COMMS_POLL_MS } from '@/lib/comms';
import type { CommsSeed } from '@/lib/types';

import { makeCommAccount, makeCommMessage } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-258 — the Comms queue stays an accurate, trustworthy reflection of the server.
 *
 * Comms has no Realtime subscription: every source it mirrors is minutes-granular (the Gmail
 * poll every 3 minutes, the classifier sweep every 2, the Mac daemon roughly once a minute), so
 * instead the view POLLS `GET /api/comms/snapshot` on a timer while the tab is visible, plus a
 * handful of triggers that mean it may have missed something sooner: the tab returning to the
 * front, a bfcache-restored page, coming back online, a failed optimistic write, and "Show more"
 * paging the shelf. These drive the backend directly (`seed(...)`, with no push involved) and
 * make the view re-read by returning it to the front, the same way a real tab would notice.
 */

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

/**
 * What a tab coming back to the front fires — retried until the dispatch actually lands a
 * snapshot read, rather than a fixed sleep before the first call. That makes it double as the
 * hydration barrier too: the very first dispatch after `page.goto` can outrun React attaching
 * the listener, the same way a real tab's first foreground event can arrive before hydration
 * finishes. Extra reads along the way are harmless — the store's re-read replaces its view
 * idempotently either way.
 */
async function returnToTab(page: Page): Promise<void> {
  await expect(async () => {
    const read = page.waitForResponse(
      (candidate) => candidate.url().includes('/api/comms/snapshot'),
      {
        timeout: 1000,
      },
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await read;
  }).toPass();
}

/** The next snapshot re-read the view makes — what it would replace a stale row with. */
async function nextSnapshot(page: Page): Promise<CommsSeed> {
  const response = await page.waitForResponse((candidate) =>
    candidate.url().includes('/api/comms/snapshot'),
  );
  return (await response.json()) as CommsSeed;
}

test('a row the classifier re-tiers moves into the open queue on the next re-read', async ({
  page,
  seed,
}) => {
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED] });
  await page.goto('/comms');
  const today = page.getByRole('region', { name: 'Today' });
  await expect(today.getByText('Lunch Thursday?')).toBeHidden();

  // Written straight to the backend — no push, the way the classifier sweep actually writes it.
  const retiered = { ...SHELVED, tier: 'today' as const };
  await seed({ commAccounts: [PERSONAL], commMessages: [retiered] });
  const settled = nextSnapshot(page);
  await returnToTab(page);

  await expect(today.getByText('Lunch Thursday?')).toBeVisible();
  const { messages } = await settled;
  expect(messages).toContainEqual(expect.objectContaining({ id: SHELVED.id, tier: 'today' }));
});

test('the last-ping line under the dots follows a poll as it lands', async ({ page, seed }) => {
  await seed({ commAccounts: [PERSONAL] });
  await page.goto('/comms');

  const ping = page.getByTestId('last-ping');
  await expect(ping).toHaveText('Last ping 2h ago · personal');

  const polled = { ...PERSONAL, last_seen_at: new Date().toISOString() };
  await seed({ commAccounts: [polled] });
  const reread = nextSnapshot(page);
  await returnToTab(page);

  await expect(ping).toHaveText('Last ping just now · personal');
  const { accounts } = await reread;
  expect(accounts).toContainEqual(
    expect.objectContaining({ id: PERSONAL.id, last_seen_at: polled.last_seen_at }),
  );
});

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
  await page.goto('/comms');
  const asap = page.getByRole('region', { name: 'ASAP' });
  await expect(asap.getByText('Needs the contract signed before noon.')).toBeHidden();

  // Written while the tab was away: nothing is pushed for it, and no poll has fired yet either.
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED, ARRIVED] });
  await returnToTab(page);

  await expect(asap.getByText('Needs the contract signed before noon.')).toBeVisible();
});

test('says it is not live once every poll fails for long enough, and stops once one lands', async ({
  page,
  seed,
}) => {
  await seed({ commAccounts: [PERSONAL], commMessages: [SHELVED] });
  // Installed before navigating, so every timer the store and view create on mount (the poll
  // interval, the view's own ticking clock, the live-window timer) is fake from the start — one
  // installed after hydration leaves those already-real timers deaf to `fastForward`, since it
  // never advances real wall time.
  await page.clock.install();
  await page.goto('/comms');
  // The hydration barrier, before anything about this test's own fake clock: a real round trip
  // through the still-real `/api/comms/snapshot`, so the poll interval and the live-window timer
  // the assertions below depend on are both known to exist before the abort route goes in.
  await returnToTab(page);
  // Scoped by text: Next's own route announcer is an `alert` too.
  const notLive = page.getByRole('alert').filter({ hasText: 'Not live' });
  await expect(notLive).toBeHidden();

  await page.route('**/api/comms/snapshot**', (route) => route.abort());
  // `fastForward` fires each timer due within the jump exactly once, not a replay of every poll
  // along the way — so one jump past the live window is enough to land past it.
  await page.clock.fastForward(COMMS_LIVE_WINDOW_MS + COMMS_POLL_MS);
  await expect(notLive).toHaveText(/^Not live — this is what was here/);

  await page.unroute('**/api/comms/snapshot**');
  await page.clock.fastForward(COMMS_POLL_MS);
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
