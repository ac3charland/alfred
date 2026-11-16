import type { Browser, Locator, Page } from '@playwright/test';

import { stableSorted } from '@/lib/sort';

import { wikiWebFixtureSet } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * What a frame of the landing web costs the style engine (ALF-364), counted in a real browser.
 *
 * The stage moves every node on every tick, so a tick should restyle each node once and nothing
 * under it. That is easy to lose without seeing it: a child whose style explicitly inherits a
 * property that doesn't inherit — preflight's `a { text-decoration: inherit }` — is restyled
 * whenever its parent's style changes, which doubled the elements restyled per frame and, at a
 * few hundred nodes, took the web from 120 fps to 25. A hover is the same kind of cost: dimming
 * the rest of the web should restyle each node and edge, not everything inside every node. Only
 * the browser's own trace shows either — jsdom has no style engine and the page looks the same
 * either way — so this reads the trace: a count of elements, which doesn't depend on how fast the
 * machine is.
 */

/** One style pass in a Chromium trace, and how many elements it restyled. */
interface TraceEvent {
  name: string;
  args?: { elementCount?: number };
}

/** How many elements each style pass restyled while `act` ran, in the order they happened. */
async function restyledDuring(
  browser: Browser,
  page: Page,
  act: () => Promise<void>,
): Promise<number[]> {
  await browser.startTracing(page, { categories: ['devtools.timeline'] });
  await act();
  const recorded = await browser.stopTracing();
  const trace = JSON.parse(recorded.toString()) as { traceEvents: TraceEvent[] };
  return trace.traceEvents.flatMap((event) =>
    event.name === 'UpdateLayoutTree' && event.args?.elementCount !== undefined
      ? [event.args.elementCount]
      : [],
  );
}

const median = (values: readonly number[]): number =>
  stableSorted(values, (a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Where `locator` sits on the page; it must be laid out. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('a web node has no box');
  return box;
}

test.describe('the Wiki landing web — what a frame restyles', () => {
  test('restyles each node once per tick while a dot is dragged, and nothing under it', async ({
    page,
    seed,
    browser,
  }) => {
    const { pages, sync } = wikiWebFixtureSet();
    await seed({ wikiPages: pages, wikiSync: [sync] });
    await page.goto('/wiki');

    const web = page.getByRole('group', { name: /Concepts & entities/ });
    const nodes = web.locator('[data-wiki-node]');
    // The node itself has no size; its link is what shows once the web is laid out.
    await expect(nodes.first().locator('a')).toBeVisible();
    const count = await nodes.count();

    const box = await boxOf(nodes.first().locator('a'));
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // A held dot keeps the physics awake, so every frame of the drag moves every node.
    const passes = await restyledDuring(browser, page, async () => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let step = 1; step <= 30; step += 1) {
        await page.mouse.move(from.x + step * 3, from.y + step * 2);
      }
      await page.mouse.up();
    });

    // The passes that restyled the web: a tick touches every node, and nothing else on the page
    // comes near that many elements.
    const ticks = passes.filter((restyled) => restyled >= count);
    expect(ticks.length).toBeGreaterThan(5);
    // A node each, and room for the names that move with them — but not a second element per node.
    expect(median(ticks)).toBeLessThan(count * 1.5);
  });

  test('dims the rest of the web under a hover by restyling each node and edge once, not what is inside them', async ({
    page,
    seed,
    browser,
  }) => {
    const { pages, sync } = wikiWebFixtureSet();
    await seed({ wikiPages: pages, wikiSync: [sync] });
    // Settled before its one paint, so no tick's restyle is mistaken for the hover's.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/wiki');

    const web = page.getByRole('group', { name: /Concepts & entities/ });
    const medina = web.getByRole('link', { name: 'John Medina, entity' });
    await expect(medina).toBeVisible();
    const nodes = await web.locator('[data-wiki-node]').count();
    const edges = await web.locator('line').count();
    // A page John Medina doesn't link to: it dims while he is hovered.
    const other = web.locator('[data-wiki-node]', {
      has: page.getByRole('link', { name: 'Zettelkasten, concept' }),
    });
    const edge = web.locator('line[data-state="rest"]').first();
    const strokeOf = () => edge.evaluate((line) => getComputedStyle(line).stroke);
    const resting = await strokeOf();

    const passes = await restyledDuring(browser, page, async () => {
      await medina.hover();
      await expect(web).toHaveAttribute('data-active', 'true');
      await expect(other).toHaveCSS('opacity', '0.3');
      expect(await strokeOf()).not.toBe(resting);

      await page.mouse.move(0, 0);
      await expect(web).not.toHaveAttribute('data-active');
      await expect(other).toHaveCSS('opacity', '1');
      expect(await strokeOf()).toBe(resting);
    });

    // In and out, a pass restyles the nodes and edges themselves, and what is inside the few
    // whose light changed. Restyling what is inside every node comes to 2.7 each.
    expect(Math.max(...passes)).toBeLessThan((nodes + edges) * 2);
  });
});
