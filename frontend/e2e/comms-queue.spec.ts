import {
  MOCK_URL,
  makeCommAccount,
  makeCommHandle,
  makeCommHealth,
  makeCommMessage,
  makeCommPerson,
  makeCommVerdict,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The triage queue through the whole stack: the three counted tiers, the collapsed shelf, and
 * every exit a row has.
 *
 * Proven end-to-end rather than in jsdom because each verb is a chain — an optimistic patch, a
 * route handler, a correction row (or deliberately none), and a row leaving the list — and the
 * thing worth checking is that the WRITE at the far end matches the verb the owner pressed.
 * "Nothing to answer" and "Not replying" look identical on screen and differ only in what they
 * teach the classifier, which is exactly the kind of difference a UI test can't see.
 */

const PERSONAL = makeCommAccount('personal', { id: '11111111-1111-4111-8111-111111111111' });
const REALPLAY = makeCommAccount('RealPlay', { id: '22222222-2222-4222-8222-222222222222' });
const IMESSAGE = makeCommAccount('iMessage', {
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'imessage',
  home: 'daemon',
});

const DANA = makeCommPerson('Dana Whitfield', { id: '44444444-4444-4444-8444-444444444444' });
const DANA_HANDLE = makeCommHandle(DANA.id, 'dana@realplay.example');

const ASAP_VERDICT = makeCommVerdict('55555555-5555-4555-8555-555555555555', {
  id: '66666666-6666-4666-8666-666666666666',
  tier: 'asap',
  reason: 'Dana is on the priority roster and named a hard deadline today.',
});

const ASAP_ROW = makeCommMessage(REALPLAY.id, {
  id: '55555555-5555-4555-8555-555555555555',
  tier: 'asap',
  judged_by: 'model',
  sender_handle: 'dana@realplay.example',
  sender_name: 'Dana W.',
  subject: 'Q3 invoice',
  body: 'Can you approve the Q3 invoice before the 5pm billing run?',
  ask: 'Needs the Q3 invoice approved before the 5pm billing run.',
  rfc822_message_id: '<q3-invoice-99@realplay.example>',
  verdict_id: ASAP_VERDICT.id,
});

const TODAY_ROW = makeCommMessage(IMESSAGE.id, {
  id: '77777777-7777-4777-8777-777777777777',
  tier: 'today',
  judged_by: 'model',
  sender_handle: '+15550119876',
  sender_name: 'Mom',
  body: 'Are you coming Sunday?',
  ask: 'Asking whether you are coming Sunday — wants a yes or no.',
});

const SECOND_TODAY_ROW = makeCommMessage(PERSONAL.id, {
  id: '88888888-8888-4888-8888-888888888888',
  tier: 'today',
  judged_by: 'model',
  sender_handle: 'priya@example.com',
  sender_name: 'Priya Raghavan',
  body: 'What times work Thursday?',
  ask: 'Waiting on your availability for the Thursday walkthrough.',
});

const WHENEVER_ROW = makeCommMessage(PERSONAL.id, {
  id: '99999999-9999-4999-8999-999999999999',
  tier: 'whenever',
  judged_by: 'model',
  sender_handle: 'marcus@example.com',
  sender_name: 'Marcus Okonkwo',
  body: 'Any chance of an intro?',
  ask: 'Asked for an intro to someone on the platform team.',
});

const SHELVED_ROW = makeCommMessage(PERSONAL.id, {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tier: 'fyi',
  judged_by: 'model',
  sender_handle: 'receipts@example.com',
  subject: 'Your order shipped',
  body: 'Nothing needed.',
  ask: 'Nothing asked.',
});

/** The bad day, minus the failure surfaces — those are seeded per test that asserts them. */
const BAD_DAY = {
  commAccounts: [PERSONAL, REALPLAY, IMESSAGE],
  commMessages: [ASAP_ROW, TODAY_ROW, SECOND_TODAY_ROW, WHENEVER_ROW, SHELVED_ROW],
  commVerdicts: [ASAP_VERDICT],
  commPeople: [DANA],
  commHandles: [DANA_HANDLE],
};

/** The mock's whole database — the far end of every write below. */
async function storedState(request: {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}) {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  return (await response.json()) as {
    items: { title: string; notes: string; source_url: string | null }[];
    commCorrections: { kind: string; chosen_tier: string; model_tier: string | null }[];
    commMessages: { id: string; tier: string | null; cleared_by: string | null }[];
  };
}

/** How many corrections the example set holds — polled, since the write lands after the row. */
async function countCorrections(request: Parameters<typeof storedState>[0]): Promise<number> {
  const state = await storedState(request);
  return state.commCorrections.length;
}

/** How many Inbox items exist — the far end of the third exit. */
async function countItems(request: Parameters<typeof storedState>[0]): Promise<number> {
  const state = await storedState(request);
  return state.items.length;
}

test.describe('the Comms triage queue', () => {
  test('counts the three tiers and keeps the shelf shut', async ({ page, seed }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await expect(page.getByLabel('1 in ASAP')).toHaveText('1');
    await expect(page.getByLabel('2 in Today')).toHaveText('2');
    await expect(page.getByLabel('1 in Whenever')).toHaveText('1');

    // The shelf carries its size in a sentence, never a badge: a count here would make it a
    // second queue and the module would have two inboxes again.
    const shelf = page.getByRole('button', { name: /FYI · 1 message · no reply owed/ });
    await expect(shelf).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Nothing asked.')).toBeHidden();

    await shelf.click();
    await expect(page.getByText('Nothing asked.')).toBeVisible();
  });

  test('expands a row to the ask, the reason and the verbs', async ({ page, seed }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await page.getByText('Needs the Q3 invoice approved before the 5pm billing run.').click();

    await expect(
      page.getByText('Can you approve the Q3 invoice before the 5pm billing run?'),
    ).toBeVisible();
    await expect(
      page.getByText('Dana is on the priority roster and named a hard deadline today.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open in Mail' })).toHaveAttribute(
      'href',
      'message://%3Cq3-invoice-99@realplay.example%3E',
    );
    await expect(page.getByRole('button', { name: 'Make an Inbox item' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nothing to answer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not replying' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change tier' })).toBeVisible();
  });

  test('"Nothing to answer" clears the row and records the demotion', async ({
    page,
    seed,
    request,
  }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await page.getByText('Needs the Q3 invoice approved before the 5pm billing run.').click();
    await page.getByRole('button', { name: 'Nothing to answer' }).click();

    await expect(page.getByLabel('0 in ASAP')).toHaveText('0');
    await expect(
      page.getByText('Needs the Q3 invoice approved before the 5pm billing run.'),
    ).toBeHidden();

    // The correction is the whole reason this verb is separate from the one beside it.
    await expect.poll(async () => countCorrections(request)).toBe(1);
    const { commCorrections, commMessages } = await storedState(request);
    expect(commCorrections[0]).toMatchObject({
      kind: 'nothing_to_answer',
      chosen_tier: 'fyi',
      model_tier: 'asap',
    });
    expect(commMessages.find((row) => row.id === ASAP_ROW.id)).toMatchObject({
      tier: 'fyi',
      cleared_by: 'nothing_to_answer',
    });
  });

  test('"Not replying" clears the row and records nothing', async ({ page, seed, request }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await page.getByText('Asking whether you are coming Sunday — wants a yes or no.').click();
    await page.getByRole('button', { name: 'Not replying' }).click();

    await expect(page.getByLabel('1 in Today')).toHaveText('1');

    const { commCorrections, commMessages } = await storedState(request);
    expect(commCorrections).toHaveLength(0);
    expect(commMessages.find((row) => row.id === TODAY_ROW.id)).toMatchObject({
      tier: 'today',
      cleared_by: 'not_replying',
    });
  });

  test('the tier picker moves a row between sections and records the correction', async ({
    page,
    seed,
    request,
  }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await page.getByText('Asked for an intro to someone on the platform team.').click();
    await page.getByRole('button', { name: 'Change tier' }).click();
    await page.getByRole('menuitem', { name: 'Today' }).click();

    await expect(page.getByLabel('0 in Whenever')).toHaveText('0');
    await expect(page.getByLabel('3 in Today')).toHaveText('3');

    await expect.poll(async () => countCorrections(request)).toBe(1);
    const { commCorrections } = await storedState(request);
    expect(commCorrections[0]).toMatchObject({
      kind: 'tier_change',
      chosen_tier: 'today',
      model_tier: 'whenever',
    });
  });

  test('"Make an Inbox item" clears the row and creates the item', async ({
    page,
    seed,
    request,
  }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await page.getByText('Waiting on your availability for the Thursday walkthrough.').click();
    await page.getByRole('button', { name: 'Make an Inbox item' }).click();

    await expect(page.getByLabel('1 in Today')).toHaveText('1');
    await expect(page.getByText('Added to Inbox')).toBeVisible();

    await expect.poll(async () => countItems(request)).toBe(1);
    const { items } = await storedState(request);
    expect(items[0]?.title).toBe('Waiting on your availability for the Thursday walkthrough.');
    expect(items[0]?.notes).toContain('From Priya Raghavan via personal');
  });

  test('the keyboard walks the queue and clears a row', async ({ page, seed, request }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');
    await expect(page.getByLabel('1 in ASAP')).toBeVisible();

    // `j` selects the first row of the queue as drawn — the ASAP one.
    await page.keyboard.press('j');
    await expect(
      page.getByText('Can you approve the Q3 invoice before the 5pm billing run?'),
    ).toBeVisible();

    await page.keyboard.press('n');

    await expect(page.getByLabel('0 in ASAP')).toHaveText('0');
    await expect.poll(async () => countCorrections(request)).toBe(1);
  });

  test('names each account and its state on the header dots', async ({ page, seed }) => {
    const now = Date.now();
    await seed({
      ...BAD_DAY,
      commAccounts: [
        makeCommAccount('personal', {
          id: PERSONAL.id,
          last_seen_at: new Date(now - 60 * 1000).toISOString(),
        }),
        makeCommAccount('RealPlay', {
          id: REALPLAY.id,
          last_seen_at: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
          last_error: 'the refresh token was rejected',
          last_error_at: new Date(now - 40 * 60 * 1000).toISOString(),
        }),

        makeCommAccount('iMessage', {
          id: IMESSAGE.id,
          kind: 'imessage',
          home: 'daemon',
          last_seen_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    });
    await page.goto('/comms');

    await expect(page.getByLabel('personal · live')).toBeVisible();
    await expect(page.getByLabel('RealPlay · erroring')).toBeVisible();
    await expect(page.getByLabel('iMessage · stale')).toBeVisible();

    // A dot says something is wrong; the sentence says what, and what to do about it.
    await expect(page.getByText(/the refresh token was rejected/)).toBeVisible();
    await expect(page.getByText(/the Mac is asleep/)).toBeVisible();
  });

  test('leaves the classifier banner off while judgment is keeping up', async ({ page, seed }) => {
    await seed(BAD_DAY);
    await page.goto('/comms');

    await expect(page.getByLabel('1 in ASAP')).toBeVisible();
    await expect(page.getByText(/Classifier stalled/)).toBeHidden();
  });

  test('raises the classifier banner when judgment has stopped', async ({ page, seed }) => {
    // Offsets carry ten minutes of headroom past the hour they are meant to read as: elapsed
    // time is floored (the module never promises more time than has passed) and the view's
    // clock ticks in 30-second steps, so an offset of exactly two hours renders as "1h ago".
    const now = Date.now();
    await seed({
      ...BAD_DAY,
      commHealth: [
        makeCommHealth({
          last_run_at: new Date(now - 60 * 1000).toISOString(),
          last_success_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
          last_error: 'anthropic: 529 overloaded',
          last_error_at: new Date(now - (2 * 60 + 10) * 60 * 1000).toISOString(),
        }),
      ],
    });
    await page.goto('/comms');

    // Its own surface, and its own voice: ingestion is healthy and only judgment has stopped,
    // which is a different fact with a different fix from a dead source.
    const banner = page.getByText(/Classifier stalled/);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('2h ago');
    await expect(page.getByText(/Everything still arriving is still being stored/)).toBeVisible();
    await expect(page.getByLabel(/erroring/)).toBeHidden();
  });
});
