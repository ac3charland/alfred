import { type SeedState, WIKI_REPO, makeWikiPage, wikiFixtureSet } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Wiki module's reading room (ALF-261), end to end against the mock backend seeded with the
 * linked fixture wiki: opening pages, following each kind of link, backlinks, a heading anchor
 * landing, and the body search. These run in a real browser for what jsdom can't show — the
 * real react-markdown render (Jest mocks it), heading ids on real heading elements, a hash scroll,
 * and the phone layout.
 */

const STACKING = '/wiki/concepts/habit-stacking';

/** A page long enough to scroll, with one code-span heading far below the fold. */
function longRead() {
  const filler = Array.from(
    { length: 40 },
    (_, index) => `Paragraph ${String(index + 1)} of the preamble.`,
  ).join('\n\n');
  return makeWikiPage('wiki/concepts/long-read.md', {
    title: 'Long read',
    body: `${filler}\n\n## The \`yaml\` parser\n\nThe part worth linking to.\n`,
  });
}

/** Seed the fixture wiki, optionally with extra pages beside it. */
async function seedWiki(
  seed: (state: SeedState) => Promise<void>,
  extra: ReturnType<typeof makeWikiPage>[] = [],
) {
  const { pages, sync } = wikiFixtureSet();
  await seed({ wikiPages: [...pages, ...extra], wikiSync: [sync] });
}

test.describe('the Wiki reading room', () => {
  test('opens a page from the index', async ({ page, seed }) => {
    await seedWiki(seed);
    await page.goto('/wiki');

    await expect(page.getByText('7 pages · synced', { exact: false })).toBeVisible();
    await page
      .getByRole('region', { name: /Concepts/ })
      .getByRole('link', { name: /Habit stacking/ })
      .click();

    await expect(page).toHaveURL(STACKING);
    await expect(page.getByRole('heading', { level: 3, name: 'Habit stacking' })).toBeVisible();
    await expect(page.getByTestId('wiki-body')).toContainText(
      'A new habit survives when its cue is something you already do.',
    );
  });

  test('follows an in-app link in the body', async ({ page, seed }) => {
    await seedWiki(seed);
    await page.goto(STACKING);

    const body = page.getByTestId('wiki-body');
    await body.getByRole('link', { name: 'James Clear' }).click();

    await expect(page).toHaveURL('/wiki/entities/james-clear');
    await expect(page.getByRole('heading', { level: 3, name: 'James Clear' })).toBeVisible();
    await expect(page.getByTestId('wiki-body')).toContainText('Wrote Atomic Habits.');
  });

  test('follows a backlink', async ({ page, seed }) => {
    await seedWiki(seed);
    await page.goto(STACKING);

    const linkedFrom = page.getByRole('region', { name: 'Linked from' });
    await expect(linkedFrom.getByRole('link')).toHaveCount(3);
    await linkedFrom.getByRole('link', { name: /Habit loop/ }).click();

    await expect(page).toHaveURL('/wiki/concepts/habit-loop');
    await expect(page.getByRole('heading', { level: 3, name: 'Habit loop' })).toBeVisible();
  });

  test('sends a raw citation to GitHub in a new tab, and renders the rest of the link table', async ({
    page,
    seed,
  }) => {
    await seedWiki(seed);
    await page.goto(STACKING);

    const body = page.getByTestId('wiki-body');
    const excerpt = body.getByRole('link', { name: 'excerpt' });
    await expect(excerpt).toHaveAttribute(
      'href',
      `https://github.com/${WIKI_REPO}/blob/main/raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour`,
    );
    await expect(excerpt).toHaveAttribute('target', '_blank');
    await expect(excerpt).toHaveAttribute('rel', 'noopener noreferrer');

    await expect(body.getByRole('link', { name: 'source folder' })).toHaveAttribute(
      'href',
      `https://github.com/${WIKI_REPO}/tree/main/raw/2026/2026-10-01-atomic-habits`,
    );
    await expect(body.getByRole('link', { name: 'the original' })).toHaveAttribute(
      'href',
      'https://jamesclear.com/habit-stacking',
    );
    // A page the snapshot doesn't hold is text, not a link.
    await expect(body.getByRole('link', { name: 'implementation intentions' })).toHaveCount(0);
    await expect(body.getByText('implementation intentions')).toHaveAttribute(
      'title',
      'Not in the wiki snapshot',
    );
    // The image is never loaded — it is a link to the file.
    await expect(body.getByRole('img')).toHaveCount(0);
    await expect(body.getByRole('link', { name: 'the loop' })).toHaveAttribute(
      'href',
      `https://github.com/${WIKI_REPO}/blob/main/raw/2026/2026-10-01-atomic-habits/assets/loop.png`,
    );
    // A same-page anchor stays on the page, pointing at a heading that carries that id.
    await expect(body.getByRole('link', { name: '#where-the-sources-disagree' })).toHaveAttribute(
      'href',
      '#where-the-sources-disagree',
    );
    await expect(body.getByRole('heading', { name: 'Where the sources disagree' })).toHaveAttribute(
      'id',
      'where-the-sources-disagree',
    );
  });

  test('lands a URL anchor on the heading with that id once the body renders', async ({
    page,
    seed,
  }) => {
    await seedWiki(seed, [longRead()]);

    await page.goto('/wiki/concepts/long-read#the--parser');

    const heading = page.getByRole('heading', { name: 'The yaml parser' });
    await expect(heading).toHaveAttribute('id', 'the--parser');
    await expect(heading).toBeInViewport();
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(0);
  });

  test('reads a page the wiki’s way in the real render: no empty id, a bracketed target literal', async ({
    page,
    seed,
  }) => {
    const edges = makeWikiPage('wiki/concepts/edges.md', {
      title: 'Edges',
      body: '## `yaml` \n\nA heading that is only code.\n\n## After\n\n[bracketed](<habit-loop.md>) and [plain](habit-loop.md).\n',
    });
    await seedWiki(seed, [edges]);
    await page.goto('/wiki/concepts/edges');

    const body = page.getByTestId('wiki-body');
    // The wiki anchors the code-only heading as '', which is no anchor: the element carries no id.
    await expect(body.getByRole('heading', { name: 'yaml' })).not.toHaveAttribute('id');
    await expect(body.getByRole('heading', { name: 'After' })).toHaveAttribute('id', 'after');
    // `<habit-loop.md>` is the wiki's literal target — no page — while the plain one opens in-app.
    await expect(body.getByRole('link', { name: /bracketed/ })).toHaveAttribute(
      'href',
      `https://github.com/${WIKI_REPO}/blob/main/wiki/concepts/%3Chabit-loop.md%3E`,
    );
    await expect(body.getByRole('link', { name: 'plain' })).toHaveAttribute(
      'href',
      '/wiki/concepts/habit-loop',
    );
  });

  test('opens the next page at the top after following a backlink from the foot of a long one', async ({
    page,
    seed,
  }) => {
    // The destination is several screens long too, so the browser can't clamp the old scroll
    // position to 0 on its own — only the page's own scroll-to-top puts it back at the top.
    const filler = Array.from(
      { length: 40 },
      (_, index) => `Follow-up paragraph ${String(index + 1)}.`,
    ).join('\n\n');
    const followUp = makeWikiPage('wiki/concepts/follow-up.md', {
      title: 'Follow-up',
      links: ['wiki/concepts/long-read.md'],
      body: `Points at the [long read](long-read.md).\n\n${filler}\n`,
    });
    await seedWiki(seed, [longRead(), followUp]);
    // Open the destination first, in-app, so its body is already cached when the backlink
    // returns to it: it renders at full length at once, with no short loading state to clamp on.
    await page.goto('/wiki/concepts/follow-up');
    await expect(page.getByTestId('wiki-body')).toContainText('Follow-up paragraph 40.');
    await page.getByTestId('wiki-body').getByRole('link', { name: 'long read' }).click();
    await expect(page).toHaveURL('/wiki/concepts/long-read');
    await expect(page.getByTestId('wiki-body')).toContainText('The part worth linking to.');

    const backlink = page
      .getByRole('region', { name: 'Linked from' })
      .getByRole('link', { name: /Follow-up/ });
    await backlink.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(0);
    await backlink.click();

    await expect(page).toHaveURL('/wiki/concepts/follow-up');
    await expect(page.getByRole('heading', { level: 3, name: 'Follow-up' })).toBeVisible();
    await expect(page.getByTestId('wiki-body')).toContainText('Follow-up paragraph 40.');
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBe(0);
  });

  test('opens a page whose file name is not ASCII from a link to it', async ({ page, seed }) => {
    const cafe = makeWikiPage('wiki/entities/café.md', {
      title: 'Café',
      body: 'Where the habit loop gets its coffee.\n',
    });
    const coffee = makeWikiPage('wiki/concepts/coffee.md', {
      title: 'Coffee',
      links: ['wiki/entities/café.md'],
      body: 'Stacked onto a visit to [the café](../entities/café.md).\n',
    });
    await seedWiki(seed, [cafe, coffee]);
    await page.goto('/wiki/concepts/coffee');

    await page.getByTestId('wiki-body').getByRole('link', { name: 'the café' }).click();

    await expect(page).toHaveURL(/\/wiki\/entities\/caf(é|%C3%A9)$/);
    await expect(page.getByRole('heading', { level: 3, name: 'Café' })).toBeVisible();
    await expect(page.getByTestId('wiki-body')).toContainText(
      'Where the habit loop gets its coffee.',
    );
  });

  test('finds a page by its body text when no title or summary matches', async ({ page, seed }) => {
    await seedWiki(seed);
    await page.goto('/wiki');

    await page.getByRole('searchbox', { name: 'Search the wiki' }).fill('pruning');

    const inText = page.getByRole('region', { name: 'In page text' });
    const hit = inText.getByRole('link', { name: /Brain Rules/ });
    await expect(hit).toBeVisible();
    await expect(hit.locator('mark')).toHaveText('pruning');
    await expect(page.getByRole('region', { name: 'Titles & summaries' })).toHaveCount(0);

    await hit.click();
    await expect(page).toHaveURL('/wiki/sources/brain-rules');
  });
});

test.describe('the Wiki reading room — phone (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders a page in one column, with nothing wider than the screen', async ({
    page,
    seed,
  }) => {
    await seedWiki(seed);
    await page.goto(STACKING);

    const title = page.getByRole('heading', { level: 3, name: 'Habit stacking' });
    const body = page.getByTestId('wiki-body');
    const sources = page.getByRole('region', { name: 'Sources' });
    const linkedFrom = page.getByRole('region', { name: 'Linked from' });
    await expect(body).toContainText('A new habit survives');

    const boxes = await Promise.all(
      [title, body, sources, linkedFrom].map(async (locator) => {
        const box = await locator.boundingBox();
        if (box === null) throw new Error('an element of the page has no box');
        return box;
      }),
    );
    // Stacked top to bottom, each starting where the one above it ended or lower…
    const bottoms = boxes.map((box) => box.y + box.height);
    expect(boxes.slice(1).filter((box, index) => box.y < (bottoms[index] ?? 0) - 1)).toEqual([]);
    // …and each inside the screen's width.
    expect(boxes.filter((box) => box.x < 0 || box.x + box.width > 390)).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
  });
});
