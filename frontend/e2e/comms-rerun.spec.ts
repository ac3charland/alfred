import type { Page } from '@playwright/test';

import { SHELF_PAGE_SIZE } from '@/lib/comms';

import {
  MOCK_URL,
  makeCommAccount,
  makeCommHandle,
  makeCommMessage,
  makeCommPerson,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Asking for a re-run, through the whole stack: the click, the wait, and the poll that finds the
 * request cleared.
 *
 * Proven end-to-end because the outcome toast rests on three things no unit double can vouch for
 * together — the reclassify route's write, the snapshot route's `watch` parameter, and the
 * PostgREST `in.()` filter behind it. The Worker is not part of this stack, so the test plays its
 * part the way the Worker really acts: it writes the answer straight to the backend, with no push,
 * and the tab notices on its next re-read.
 */

const PERSONAL = makeCommAccount('personal', { id: '11111111-1111-4111-8111-111111111111' });
const DANA = makeCommPerson('Dana Whitfield', { id: '44444444-4444-4444-8444-444444444444' });
const DANA_HANDLE = makeCommHandle(DANA.id, 'dana@example.com');

const DANA_ASK = 'Asking whether you can cover Thursday’s standup.';
const DANA_ROW = makeCommMessage(PERSONAL.id, {
  id: '55555555-5555-4555-8555-555555555555',
  tier: 'today',
  judged_by: 'model',
  sender_handle: 'dana@example.com',
  sender_name: 'Dana W.',
  subject: 'Thursday standup',
  body: 'Any chance you could run standup Thursday?',
  ask: DANA_ASK,
});

const QUEUE = {
  commAccounts: [PERSONAL],
  commPeople: [DANA],
  commHandles: [DANA_HANDLE],
};

/** The mock's whole database — the far end of the request. */
async function storedRow(request: {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}) {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await response.json()) as {
    commMessages: {
      id: string;
      reclassify_requested_at: string | null;
      reclassify_failed_at: string | null;
      classify_attempts: number;
    }[];
  };
  return state.commMessages.find((row) => row.id === DANA_ROW.id);
}

/** One column of Dana's row as the mock stores it; `undefined` if the row is not there at all. */
async function storedColumn(
  request: Parameters<typeof storedRow>[0],
  column: 'reclassify_requested_at' | 'reclassify_failed_at',
): Promise<string | null | undefined> {
  const row = await storedRow(request);
  return row?.[column];
}

/**
 * What a tab coming back to the front fires — retried until it actually lands a snapshot read,
 * which also makes it the hydration barrier: the first dispatch after `page.goto` can outrun React
 * attaching the listener, exactly as a real tab's first foreground event can.
 */
async function returnToTab(page: Page): Promise<void> {
  await expect(async () => {
    const read = page.waitForResponse(
      (candidate) => candidate.url().includes('/api/comms/snapshot'),
      { timeout: 1000 },
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await read;
  }).toPass({ timeout: 10_000 });
}

/**
 * Open Dana's row and wait until its detail is really open: out of the accessibility tree's
 * `aria-hidden`, and finished growing. `getByText` alone proves neither — it matches text inside a
 * collapsed, clipped region — and a click that lands mid-transition can be swallowed.
 */
async function openRow(page: Page): Promise<void> {
  await page.getByText(DANA_ASK).click();
  const detail = page.getByTestId('comms-row-detail');
  await expect(detail).toHaveAttribute('aria-hidden', 'false');
  await detail.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
}

/**
 * Ask for the re-run and wait for the button to say it was sent. The click is retried until it
 * has that effect: a second one is harmless, since the button disables itself after the first.
 */
async function pressRerun(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: 'Re-run classifier' }).click({ timeout: 2000 });
    await expect(page.getByRole('button', { name: /Re-run requested/ })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });
}

async function askForRerun(page: Page): Promise<void> {
  await openRow(page);
  await pressRerun(page);
}

test.describe('asking for a re-run', () => {
  test('says the request went out, then how the verdict changed once the Worker answers', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ ...QUEUE, commMessages: [DANA_ROW] });
    await page.goto('/comms');

    await askForRerun(page);

    // At once, before the write has even landed: the button and the collapsed row both say so.
    await expect(page.getByRole('button', { name: /Re-run requested/ })).toBeDisabled();
    await expect(page.getByText('Re-run pending')).toBeVisible();
    await expect.poll(async () => storedColumn(request, 'reclassify_requested_at')).toBeTruthy();

    // The Worker answers: the row is on ASAP and the request is gone.
    await seed({
      ...QUEUE,
      commMessages: [{ ...DANA_ROW, tier: 'asap', reclassify_requested_at: null }],
    });
    await returnToTab(page);

    await expect(page.getByText('Re-run · Dana Whitfield: Today → ASAP')).toBeVisible();
    await expect(page.getByText('Re-run pending')).toBeHidden();
    await expect(page.getByLabel('1 in ASAP')).toHaveText('1');
  });

  test('says the tier stayed the same', async ({ page, seed }) => {
    await seed({ ...QUEUE, commMessages: [DANA_ROW] });
    await page.goto('/comms');
    await askForRerun(page);
    await expect(page.getByText('Re-run pending')).toBeVisible();

    await seed({ ...QUEUE, commMessages: [{ ...DANA_ROW, reclassify_requested_at: null }] });
    await returnToTab(page);

    await expect(page.getByText('Re-run · Dana Whitfield: still Today')).toBeVisible();
  });

  test('still says so when the row moved onto a shelf page the tab has not loaded', async ({
    page,
    seed,
  }) => {
    // A re-run that demotes a row files it on the shelf, which is paged newest first. Dana's row
    // is older than a full page of newer shelf mail, so the snapshot no longer holds it at all —
    // only the `watch` parameter can find it.
    const newerShelf = Array.from({ length: SHELF_PAGE_SIZE + 5 }, (_unused, index) =>
      makeCommMessage(PERSONAL.id, {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        tier: 'fyi',
        judged_by: 'model',
        subject: `Receipt ${String(index)}`,
      }),
    );
    const old = {
      ...DANA_ROW,
      received_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await seed({ ...QUEUE, commMessages: [old, ...newerShelf] });
    await page.goto('/comms');
    await askForRerun(page);
    await expect(page.getByText('Re-run pending')).toBeVisible();

    await seed({
      ...QUEUE,
      commMessages: [{ ...old, tier: 'fyi', reclassify_requested_at: null }, ...newerShelf],
    });
    await returnToTab(page);

    await expect(page.getByText('Re-run · Dana Whitfield: Today → FYI')).toBeVisible();
    await expect(page.getByLabel('0 in Today')).toHaveText('0');
  });

  test('says the re-run failed when the Worker gave up, and the line outlives a reload', async ({
    page,
    seed,
  }) => {
    await seed({ ...QUEUE, commMessages: [DANA_ROW] });
    await page.goto('/comms');
    await askForRerun(page);
    await expect(page.getByText('Re-run pending')).toBeVisible();

    const failedAt = new Date().toISOString();
    await seed({
      ...QUEUE,
      commMessages: [
        { ...DANA_ROW, reclassify_requested_at: null, reclassify_failed_at: failedAt },
      ],
    });
    await returnToTab(page);

    await expect(page.getByText('Re-run failed · Dana Whitfield: kept Today')).toBeVisible();

    // Reloaded: the toast is gone, but the row still says why nothing changed.
    await page.reload();
    await openRow(page);
    await expect(page.getByText(/Re-run failed/)).toBeVisible();
    await expect(page.getByText(/so this one stands/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-run classifier' })).toBeEnabled();
  });

  test('clears an earlier failure the moment the owner asks again', async ({
    page,
    seed,
    request,
  }) => {
    await seed({
      ...QUEUE,
      commMessages: [{ ...DANA_ROW, reclassify_failed_at: new Date().toISOString() }],
    });
    await page.goto('/comms');
    await openRow(page);
    await expect(page.getByText(/Re-run failed/)).toBeVisible();

    await pressRerun(page);

    await expect(page.getByText(/Re-run failed/)).toBeHidden();
    await expect.poll(async () => storedColumn(request, 'reclassify_failed_at')).toBeNull();
    expect(await storedColumn(request, 'reclassify_requested_at')).toBeTruthy();
  });
});
