import type { Locator } from '@playwright/test';

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
 * few hundred nodes, took the web from 120 fps to 25. Only the browser's own trace shows it —
 * jsdom has no style engine and the page looks the same either way — so this reads the trace:
 * a count of elements, which doesn't depend on how fast the machine is.
 */

/** One style pass in a Chromium trace, and how many elements it restyled. */
interface TraceEvent {
  name: string;
  args?: { elementCount?: number };
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
    await browser.startTracing(page, { categories: ['devtools.timeline'] });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(from.x + step * 3, from.y + step * 2);
    }
    await page.mouse.up();
    const recorded = await browser.stopTracing();
    const trace = JSON.parse(recorded.toString()) as { traceEvents: TraceEvent[] };

    // The passes that restyled the web: a tick touches every node, and nothing else on the page
    // comes near that many elements.
    const ticks = trace.traceEvents.flatMap((event) =>
      event.name === 'UpdateLayoutTree' &&
      event.args?.elementCount !== undefined &&
      event.args.elementCount >= count
        ? [event.args.elementCount]
        : [],
    );
    expect(ticks.length).toBeGreaterThan(5);
    // A node each, and room for the names that move with them — but not a second element per node.
    expect(median(ticks)).toBeLessThan(count * 1.5);
  });
});
