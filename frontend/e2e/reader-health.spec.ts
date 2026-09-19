import type { Page } from '@playwright/test';

import {
  makeCommAccount,
  makeReaderHealth,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The reading list's health surface (`/reader`): the one banner the module may show, which of
 * the three states wins when several are true at once, and what a Reader whose tick has never
 * fired says instead.
 *
 * End-to-end rather than in jsdom because the whole surface is derived from rows the shell reads
 * at request time — the singleton health row and the `gmail-personal` account — so the states
 * below are seeded as rows and left to travel the real read path into the real view.
 *
 * Every seeded row is shaped against `NOW` rather than a calendar date: "the ceiling is reached"
 * is `calls_day` being TODAY in UTC and the tick having run recently, so a fixture pinned to a
 * fixed day would stop meaning anything the morning after it was written.
 */

const NOW = new Date();

/**
 * The module's banner. Scoped to the live regions that actually SAY something, because the
 * shell also mounts dnd-kit's own empty `role="status"` region — which would otherwise make
 * "exactly one banner renders" unassertable.
 */
function readerBanner(page: Page) {
  return page.getByRole('status').filter({ hasText: /\S/ });
}

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
});

/** The mailbox, polling happily — so the Gmail banner never wins by accident. */
function liveAccount() {
  return makeCommAccount('Gmail personal', {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    key: 'gmail-personal',
    last_seen_at: new Date(NOW.getTime() - 60 * 1000).toISOString(),
  });
}

/** The same mailbox, refusing the poll — the one state that needs a person. */
function deadAccount() {
  return makeCommAccount('Gmail personal', {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    key: 'gmail-personal',
    last_seen_at: new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString(),
    last_error: 'invalid_grant',
    last_error_at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * Two claimed posts the tick has not summarised: pending, retries unspent, a body to work from.
 * These are what the ceiling banner counts as waiting for tomorrow.
 */
function pendingPosts() {
  return [
    makeReaderPost(PUBLICATION.id, {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1',
      title: 'The AI capex question',
      author: 'Stratechery',
      word_count: 2640,
      summary_state: 'pending',
    }),
    makeReaderPost(PUBLICATION.id, {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2',
      title: 'Open Thread 348',
      author: 'Astral Codex Ten',
      word_count: 6500,
      summary_state: 'pending',
    }),
  ];
}

test.describe('the Reader health surface', () => {
  test('says the daily ceiling is reached, with the cap and how many posts wait', async ({
    page,
    seed,
  }) => {
    await seed({
      commAccounts: [liveAccount()],
      readerPublications: [PUBLICATION],
      readerPosts: pendingPosts(),
      readerHealth: [makeReaderHealth('ceiling', {}, NOW)],
    });
    await page.goto('/reader');

    const banner = readerBanner(page);
    await expect(banner).toHaveCount(1);
    await expect(banner).toContainText('Daily summary ceiling reached (30)');
    await expect(banner).toContainText('2 claimed posts wait for tomorrow');
    // Nothing is broken, so the summariser dot stays green and the line beside it says so in
    // words — the dot itself is decorative wherever the caller names the state.
    await expect(page.getByTestId('reader-health-dots')).toContainText('summariser · live');
  });

  test('lets the dead mailbox win over the ceiling — nothing new is arriving to summarise', async ({
    page,
    seed,
  }) => {
    await seed({
      commAccounts: [deadAccount()],
      readerPublications: [PUBLICATION],
      readerPosts: pendingPosts(),
      readerHealth: [makeReaderHealth('ceiling', {}, NOW)],
    });
    await page.goto('/reader');

    const banner = readerBanner(page);
    await expect(banner).toHaveCount(1);
    await expect(banner).toContainText('Gmail is not delivering.');
    await expect(banner).toContainText('invalid_grant');
    await expect(banner).not.toContainText('Daily summary ceiling reached');
  });

  test('names the error the tick stamped before it could ever record a run', async ({
    page,
    seed,
  }) => {
    await seed({
      commAccounts: [liveAccount()],
      readerPublications: [PUBLICATION],
      readerPosts: pendingPosts(),
      // A misconfigured deploy: the tick fires, fails its credential check ahead of the run
      // stamp, and writes that error to an otherwise-untouched row. No run, but not silence.
      readerHealth: [
        makeReaderHealth(
          'preflight',
          { last_error_at: new Date(NOW.getTime() - 2 * 60 * 1000).toISOString() },
          NOW,
        ),
      ],
    });
    await page.goto('/reader');

    const banner = readerBanner(page);
    await expect(banner).toHaveCount(1);
    await expect(banner).toContainText('Summariser stalled');
    await expect(banner).toContainText('ANTHROPIC_API_KEY is not set');
    await expect(page.getByTestId('reader-health-dots')).toContainText('summariser · stalled');
  });

  test('says the summariser has never run when the tick has never stamped the seeded row', async ({
    page,
    seed,
  }) => {
    await seed({
      commAccounts: [liveAccount()],
      readerPublications: [PUBLICATION],
      readerPosts: pendingPosts(),
      // The row the migration seeds and nothing has filled in yet — what a Reader whose cron has
      // never fired actually looks like in the database, rather than a table with no row at all.
      readerHealth: [makeReaderHealth('never', {}, NOW)],
    });
    await page.goto('/reader');

    await expect(
      page.getByText("The summariser has never run — check the Worker's cron."),
    ).toBeVisible();
    await expect(page.getByTestId('reader-health-dots')).toContainText('summariser · never ran');
    // Before the first tick there is nothing to be stalled from, so the module owes no banner.
    await expect(readerBanner(page)).toHaveCount(0);
  });
});
