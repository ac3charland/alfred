import {
  MOCK_URL,
  makeCommAccount,
  makeCommMessage,
  makeFolder,
  makeProject,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Reader module's shell (ALF-233): its three routes, its sidebar, and its place in
 * the module switcher and the command palette.
 *
 * Proven end-to-end rather than in jsdom for the same reason `comms-shell.spec.ts` is: the point
 * is that a FOURTH module resolves correctly through the whole stack — the shared shell layout
 * seeds it, `ModuleRouter` derives it from the URL, and a switcher tap moves between modules
 * with no reload.
 *
 * The first half covers the shell only (routes, nav, switcher, ⌘K, empty states) and seeds no
 * reader rows; the journeys over seeded posts — open, archive, the Comms shelf line — follow.
 */

const FOLDER = makeFolder('Errands', { id: '66666666-6666-4666-8666-666666666666' });
const PROJECT = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111', key: 'ALF' });
const ACCOUNT = makeCommAccount('personal', { id: '33333333-3333-4333-8333-333333333333' });

test.describe('the Reader module shell', () => {
  test('opens on the reading list, with its resting empty state', async ({ page, seed }) => {
    await seed({});
    await page.goto('/reader');

    await expect(page.getByRole('heading', { level: 2, name: 'Reader' })).toBeVisible();
    await expect(page.getByText('Nothing new to read.')).toBeVisible();
    await expect(
      page.getByText('Newsletters from your publications land here as they arrive, summarised.'),
    ).toBeVisible();
  });

  test('lists the nav with its three links', async ({ page, seed }) => {
    await seed({});
    await page.goto('/reader');

    const nav = page.getByRole('navigation', { name: 'Reader' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reading list' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Archive' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Publications' })).toBeVisible();
  });

  test('marks Reader current in the switcher', async ({ page, seed }) => {
    await seed({});
    await page.goto('/reader');

    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher.getByRole('link', { name: 'Reader' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('reaches Publications from the command palette', async ({ page, seed }) => {
    await seed({});
    await page.goto('/priority');

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Go to a place' }).fill('Publications');
    await page.getByRole('option', { name: 'Publications' }).click();

    await expect(page).toHaveURL(/\/reader\/publications$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Publications' })).toBeVisible();
  });

  test('server-renders the archive and publications empty states on a hard load', async ({
    page,
    seed,
  }) => {
    await seed({});

    await page.goto('/reader/archive');
    await expect(page.getByRole('heading', { level: 2, name: 'Archive' })).toBeVisible();
    await expect(page.getByText('Nothing archived yet.')).toBeVisible();
    await expect(
      page.getByText('Archive a post from the reading list and it lands here.'),
    ).toBeVisible();

    await page.goto('/reader/publications');
    await expect(page.getByRole('heading', { level: 2, name: 'Publications' })).toBeVisible();
    await expect(page.getByText('No publications yet.')).toBeVisible();
    await expect(
      page.getByText(
        'Substack senders are added automatically once their mail arrives; promote anyone else from the candidates.',
      ),
    ).toBeVisible();
  });

  test('switches between all four modules from the switcher without a reload', async ({
    page,
    seed,
  }) => {
    await seed({ folders: [FOLDER], projects: [PROJECT], commAccounts: [ACCOUNT] });
    await page.goto('/priority');

    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await switcher.getByRole('link', { name: 'Reader' }).click();
    await expect(page).toHaveURL(/\/reader$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Reader' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Reader' })).toBeVisible();
    await expect(switcher.getByRole('link', { name: 'Reader' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await switcher.getByRole('link', { name: 'Comms' }).click();
    await expect(page).toHaveURL(/\/comms$/);
    await expect(page.getByRole('navigation', { name: 'Comms' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Code' }).click();
    await expect(page).toHaveURL(/\/code$/);
    await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/priority$/);
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Reader' }).click();
    await expect(page).toHaveURL(/\/reader$/);
    await expect(page.getByRole('navigation', { name: 'Reader' })).toBeVisible();
  });
});

test.describe('the Reader module shell — phone (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('reaches the module through the drawer', async ({ page, seed }) => {
    await seed({});
    await page.goto('/priority');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Reader' }).click();

    await expect(page).toHaveURL(/\/reader$/);
    await expect(page.getByRole('navigation', { name: 'Reader' })).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('link', { name: 'Reading list' }),
    ).toBeVisible();
  });

  test('renders the reading list heading and empty state on the phone', async ({ page, seed }) => {
    await seed({});
    await page.goto('/reader');

    await expect(page.getByRole('heading', { level: 2, name: 'Reader' })).toBeVisible();
    await expect(page.getByText('Nothing new to read.')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// The journeys over seeded posts: open, overview, archive — and the Comms shelf's account of
// what the Reader claimed.
// ---------------------------------------------------------------------------------------------

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '44444444-4444-4444-8444-444444444444',
});

/** A done post with a canonical URL, a done post with only a Message-ID, and a pending one. */
function seededPosts() {
  return [
    makeReaderPost(PUBLICATION.id, {
      id: '55555555-5555-4555-8555-555555555551',
      title: 'How near is the intelligence explosion, really?',
      author: 'Second Thoughts',
      canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      rfc822_message_id: '<explosion@mail.substack.com>',
      word_count: 3220,
      summary_state: 'done',
      headline: 'Three loops, one with evidence.',
      gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
      overview: makeReaderOverview({ novel_ideas: ['Only automated ML research has evidence.'] }),
      received_at: '2026-09-16T12:00:00.000Z',
    }),
    makeReaderPost(PUBLICATION.id, {
      id: '55555555-5555-4555-8555-555555555552',
      title: 'Import AI 412: three new evals, and a robot that folds',
      author: 'Import AI',
      canonical_url: null,
      rfc822_message_id: '<import-ai-412@mail.substack.com>',
      word_count: 1840,
      summary_state: 'done',
      headline: 'A rerun, plus one robotics number.',
      gist: 'Roundup issue; the one new item is a robotics dexterity eval.',
      overview: makeReaderOverview(),
      received_at: '2026-09-16T11:00:00.000Z',
    }),
    makeReaderPost(PUBLICATION.id, {
      id: '55555555-5555-4555-8555-555555555553',
      title: 'The AI capex question',
      author: 'Stratechery',
      canonical_url: 'https://stratechery.com/2026/the-ai-capex-question/',
      word_count: 2640,
      summary_state: 'pending',
      received_at: '2026-09-16T10:00:00.000Z',
    }),
  ];
}

test.describe('the reading list — the journeys', () => {
  test('renders the seeded posts newest first, with the count in the heading and the nav', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    await expect(page.getByText('3 to read')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Reader' }).getByLabel('3 to read'),
    ).toHaveText('3');

    const rows = page.getByTestId('reader-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('How near is the intelligence explosion, really?');
    await expect(rows.nth(1)).toContainText('Import AI 412');
    await expect(rows.nth(2)).toContainText('The AI capex question');
    await expect(rows.nth(2)).toContainText('summarising…');
  });

  test('Open is the canonical URL when the post has one, else the Gmail permalink', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    const rows = page.getByTestId('reader-row');
    const canonical = rows.nth(0).getByRole('link', { name: 'Open' });
    await expect(canonical).toHaveAttribute(
      'href',
      'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
    );
    await expect(canonical).toHaveAttribute('target', '_blank');
    await expect(canonical).toHaveAttribute('rel', 'noreferrer');

    const mailbox = rows.nth(1).getByRole('link', { name: 'Open' });
    await expect(mailbox).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#search/rfc822msgid:import-ai-412%40mail.substack.com',
    );
  });

  test('clicking Open stamps opened_at on the row', async ({ page, seed, request }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('reader-row').nth(0).getByRole('link', { name: 'Open' }).click(),
    ]);
    await popup.close();

    await expect
      .poll(async () => {
        const response = await request.get(`${MOCK_URL}/__mock__/state`);
        const state = (await response.json()) as {
          readerPosts: { id: string; opened_at: string | null }[];
        };
        return state.readerPosts.find((post) => post.id === '55555555-5555-4555-8555-555555555551')
          ?.opened_at;
      })
      // A string, not merely "not null": `.not.toBeNull()` also passes on the `undefined` a row
      // the mock never held would return, which is the failure this poll exists to catch.
      .toEqual(expect.any(String));
  });

  test('the overview expands in place, one row at a time is not enforced', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    const row = page.getByTestId('reader-row').nth(0);
    // The collapsed region stays mounted for the height animation, so "closed" is asserted
    // through the accessibility tree (`AnimatedHeightCollapse` marks it aria-hidden + inert)
    // rather than through a text locator, which sees the clipped node as visible.
    await expect(row.getByRole('heading', { name: 'Novel ideas' })).toBeHidden();

    await row.getByRole('button', { name: 'Overview' }).click();

    await expect(row.getByRole('heading', { name: 'Novel ideas' })).toBeVisible();
    await expect(row.getByText('Only automated ML research has evidence.')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Hide overview' })).toBeVisible();

    // The pending row offers no Overview verb: there is nothing to show yet.
    await expect(
      page
        .getByTestId('reader-row')
        .nth(2)
        .getByRole('button', { name: /overview/i }),
    ).toHaveCount(0);
  });

  test('Archive collapses the row, removes it, and takes the count down by one', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    await page.getByTestId('reader-row').nth(1).getByRole('button', { name: 'Archive' }).click();

    await expect(page.getByTestId('reader-row')).toHaveCount(2);
    await expect(page.getByText('Import AI 412')).toHaveCount(0);
    await expect(page.getByText('2 to read')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Reader' }).getByLabel('2 to read'),
    ).toHaveText('2');
  });

  test('the Comms shelf says how many newsletters went to the Reader, and keeps them off it', async ({
    page,
    seed,
  }) => {
    await seed({
      commAccounts: [ACCOUNT],
      commMessages: [
        makeCommMessage(ACCOUNT.id, { tier: 'today', judged_by: 'model' }),
        makeCommMessage(ACCOUNT.id, { tier: 'fyi', judged_by: 'model', subject: 'A receipt' }),
        makeCommMessage(ACCOUNT.id, {
          tier: 'fyi',
          judged_by: 'filter',
          filtered_reason: 'newsletter',
          subject: 'Import AI 412',
          reader_claimed_at: '2026-09-16T12:05:00.000Z',
        }),
        makeCommMessage(ACCOUNT.id, {
          tier: 'fyi',
          judged_by: 'filter',
          filtered_reason: 'newsletter',
          subject: 'The Grain Ledger',
          reader_claimed_at: '2026-09-16T12:05:00.000Z',
        }),
      ],
    });
    await page.goto('/comms');

    await expect(
      page.getByRole('button', { name: /FYI · 1 message · no reply owed/ }),
    ).toBeVisible();
    const line = page.getByText(/2 newsletters went to the/);
    await expect(line).toBeVisible();
    await expect(line.getByRole('link', { name: /Reader/ })).toHaveAttribute('href', '/reader');
    await line.getByRole('link', { name: /Reader/ }).click();
    await expect(page).toHaveURL(/\/reader$/);
  });
});
