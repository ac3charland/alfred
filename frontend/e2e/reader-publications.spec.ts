import { formatPostDate } from '@/components/reader/reader-format';

import {
  MOCK_URL,
  makeCommAccount,
  makeCommMessage,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The publications roster (`/reader/publications`): pausing, renaming, promoting a candidate off
 * `v_reader_candidates`, and copying the Gmail filter query — against the mock backend's computed
 * views and its 409 on a duplicate handle.
 */

const ACCOUNT = makeCommAccount('Gmail personal', {
  id: '77777777-7777-4777-8777-777777777777',
  key: 'gmail-personal',
});

const ENABLED = makeReaderPublication('Second Thoughts', {
  id: '88888888-8888-4888-8888-888888888881',
  handle: 'secondthoughts@substack.com',
  source: 'auto',
});

const PAUSED = makeReaderPublication('Some Substack I stopped reading', {
  id: '88888888-8888-4888-8888-888888888882',
  handle: 'quietletter@substack.com',
  source: 'auto',
  enabled: false,
});

/** A bulk sender on the personal mailbox, inbound with a list header, not on the roster. */
function candidateMessage(overrides: Parameters<typeof makeCommMessage>[1] = {}) {
  return makeCommMessage(ACCOUNT.id, {
    direction: 'inbound',
    has_list_header: true,
    sender_handle: 'hello@bensbites.beehiiv.com',
    sender_name: "Ben's Bites",
    ...overrides,
  });
}

test.describe('the publications roster', () => {
  test('pausing a publication flips enabled on the server and the count line', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ commAccounts: [ACCOUNT], readerPublications: [ENABLED, PAUSED] });
    await page.goto('/reader/publications');

    await expect(page.getByText('1 enabled · 1 paused')).toBeVisible();

    await page.getByRole('button', { name: 'Enabled' }).click();

    await expect(page.getByText('0 enabled · 2 paused')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paused' }).first()).toBeVisible();

    await expect
      .poll(async () => {
        const response = await request.get(`${MOCK_URL}/__mock__/state`);
        const state = (await response.json()) as {
          readerPublications: { id: string; enabled: boolean }[];
        };
        return state.readerPublications.find((row) => row.id === ENABLED.id)?.enabled;
      })
      .toBe(false);
  });

  test('renames a publication and it persists across a reload', async ({ page, seed }) => {
    await seed({ commAccounts: [ACCOUNT], readerPublications: [ENABLED] });
    await page.goto('/reader/publications');

    await page.getByRole('button', { name: 'Second Thoughts' }).click();
    const input = page.getByRole('textbox', { name: 'Edit name for Second Thoughts' });
    await input.fill('Second Thoughts Weekly');
    await input.press('Enter');

    await expect(page.getByText('Second Thoughts Weekly')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Second Thoughts Weekly')).toBeVisible();
  });

  test('promotes a candidate onto the roster with the owner chip, off the candidates list', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ commAccounts: [ACCOUNT], commMessages: [candidateMessage()] });
    await page.goto('/reader/publications');

    await expect(page.getByText("Ben's Bites")).toBeVisible();
    await expect(page.getByText('No publications yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText('No candidates.')).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: 'hello@bensbites.beehiiv.com' });
    await expect(card).toBeVisible();
    await expect(card.getByText('owner')).toBeVisible();
    // The name the candidate row showed, not the handle's local part ("hello").
    await expect(card.getByText("Ben's Bites")).toBeVisible();

    const response = await request.get(`${MOCK_URL}/__mock__/state`);
    const state = (await response.json()) as {
      readerPublications: { handle: string; name: string; source: string }[];
    };
    expect(
      state.readerPublications.some(
        (row) =>
          row.handle === 'hello@bensbites.beehiiv.com' &&
          row.source === 'owner' &&
          row.name === "Ben's Bites",
      ),
    ).toBe(true);
  });

  test('ranks candidates by message volume, the loudest sender first', async ({ page, seed }) => {
    await seed({
      commAccounts: [ACCOUNT],
      commMessages: [
        // Amazon is seeded FIRST — if the view served rows in insertion order rather than
        // ranking them, the quieter sender would come out on top and this assertion would
        // catch it. Seeding the louder sender first would let the test pass even with the
        // `.order()` chain deleted, since insertion order and rank order would coincide.
        candidateMessage({ sender_handle: 'store-news@amazon.com', sender_name: 'Amazon.com' }),
        // Ben's Bites: three messages — the louder sender — seeded after, so it must still rank
        // above Amazon, exercising the view's `.order(message_count).order(last_seen_at)`.
        candidateMessage(),
        candidateMessage(),
        candidateMessage(),
      ],
    });
    await page.goto('/reader/publications');

    const candidateRows = page.getByRole('listitem').filter({ hasText: /message/ });
    await expect(candidateRows).toHaveCount(2);
    await expect(candidateRows.first()).toContainText("Ben's Bites");
    await expect(candidateRows.first()).toContainText('3 messages');
    await expect(candidateRows.last()).toContainText('Amazon.com');
    await expect(candidateRows.last()).toContainText('1 message ·');
  });

  test('shows a publication’s last post date, or that it has none yet', async ({ page, seed }) => {
    const LAST_POST_AT = '2026-09-16T12:00:00.000Z';
    const withPost = makeReaderPublication('Second Thoughts', {
      id: '88888888-8888-4888-8888-888888888883',
      handle: 'secondthoughts@substack.com',
      source: 'auto',
    });
    const withoutPost = makeReaderPublication('Fresh Letter', {
      id: '88888888-8888-4888-8888-888888888884',
      handle: 'fresh@substack.com',
      source: 'auto',
    });
    await seed({
      commAccounts: [ACCOUNT],
      readerPublications: [withPost, withoutPost],
      readerPosts: [makeReaderPost(withPost.id, { received_at: LAST_POST_AT })],
    });
    await page.goto('/reader/publications');

    const withPostCard = page.getByRole('listitem').filter({ hasText: 'Second Thoughts' });
    // The card formats this in LOCAL time, and the IANA tz database spans a 26-hour range, so no
    // fixed instant renders the same calendar date in every zone the suite might run in. Rather
    // than pin a literal date, derive the expectation from the same formatter the card uses —
    // Playwright's browser inherits the host's TZ, so Node here and the page agree.
    await expect(
      withPostCard.getByText(`last post ${formatPostDate(LAST_POST_AT, new Date())}`),
    ).toBeVisible();

    const withoutPostCard = page.getByRole('listitem').filter({ hasText: 'Fresh Letter' });
    await expect(withoutPostCard.getByText('no posts yet')).toBeVisible();
  });

  test('copies the Gmail filter query over the enabled, sorted handles', async ({
    page,
    seed,
    context,
  }) => {
    await seed({ commAccounts: [ACCOUNT], readerPublications: [ENABLED, PAUSED] });
    // The copy is a real clipboard write; grant the permission so it succeeds (and the
    // confirming toast fires) under headless Chromium, mirroring `code-links.spec.ts`.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/reader/publications');

    await page.getByRole('button', { name: 'Copy Gmail filter query' }).click();

    await expect(page.getByText('Gmail filter query copied')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe('from:(secondthoughts@substack.com)');
  });
});
