#!/usr/bin/env node
/**
 * What a frame of the wiki landing's web costs the style engine, at the real wiki's size.
 *
 *   docs/demos/alf-364-wiki-web-performance/with-app.sh
 *
 * REAL: the Next app `with-app.sh` boots, its login form, the landing and its web, in headless
 * Chromium. STOOD UP LOCALLY: Supabase (the E2E harness's in-memory mock), seeded with a
 * generated wiki of the real one's size — 261 concepts and entities, 542 links.
 *
 * A dot is dragged, which keeps the physics awake so every frame moves every node, twice: on the
 * page as built, and on the same page with the fix's one class taken off the node links. Each
 * time Chromium's trace says how many elements every style pass restyled, and its counters say
 * how long style took.
 *
 * Then a node is hovered and left on the settled web (reduced motion, so no tick is counted with
 * it), and the trace says how many elements the largest pass restyled: the dimming of everything
 * else.
 *
 * Output is deterministic: the element counts are printed per node to one decimal, and the
 * timings only as which side of a wide band they fall on.
 */
import process from 'node:process';

import { chromium } from '@playwright/test';

const APP = process.env.APP_URL;
const MOCK = process.env.MOCK_URL;
const NODES = 261;
const EDGES = 542;
const FIX = '[text-decoration:none]';

/** A linked wiki, the same on every run: hubs gather links the way real pages do. */
function bigWiki() {
  let state = 7;
  const random = () => {
    state = (1_664_525 * state + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
  const paths = Array.from({ length: NODES }, (_, index) =>
    index % 3 === 2 ? `wiki/entities/entity-${index}.md` : `wiki/concepts/concept-${index}.md`,
  );
  const links = paths.map(() => new Set());
  const ends = [0, 1];
  for (let made = 0; made < EDGES; ) {
    const a = Math.floor(random() * NODES);
    const b = ends[Math.floor(random() * ends.length)];
    if (a === b || links[a].has(paths[b])) continue;
    links[a].add(paths[b]);
    ends.push(a, b);
    made += 1;
  }
  return paths.map((path, index) => ({
    path,
    section: path.split('/')[1],
    title: `Page ${index}`,
    summary: '',
    tags: [],
    sources: [],
    links: [...links[index]],
    created: '2026-10-01',
    updated: '2026-10-03',
    body: `# Page ${index}\n`,
    parse_error: null,
    blob_oid: `b10b${String(index).padStart(36, '0')}`,
    commit_oid: 'c0ffee0000000000000000000000000000000000',
    synced_at: '2026-10-03T12:00:00.000Z',
    search: null,
  }));
}

const post = (path, data) =>
  fetch(`${MOCK}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

await post('/__mock__/reset', {});
await post('/__mock__/seed', {
  wikiPages: bigWiki(),
  wikiSync: [
    {
      id: 1,
      commit_oid: 'c0ffee0000000000000000000000000000000000',
      synced_at: '2026-10-03T12:00:00.000Z',
      pending: 0,
      last_error: null,
      last_error_at: null,
    },
  ],
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${APP}/login`);
await page.getByLabel('Email').fill('demo@alfred.test');
await page.getByLabel('Password').fill('demo-password-123');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(`${APP}/`);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const styleSeconds = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((metric) => metric.name === 'RecalcStyleDuration')?.value ?? 0;
};

/** Drag a dot across the stage while tracing; what the style passes that moved the web cost. */
async function measure() {
  await page.goto(`${APP}/wiki`);
  const web = page.getByRole('group', { name: /Concepts & entities/ });
  const nodes = web.locator('[data-wiki-node]');
  await nodes.first().locator('a').waitFor();
  const count = await nodes.count();
  const box = await nodes.nth(40).locator('a').boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await browser.startTracing(page, { categories: ['devtools.timeline'] });
  const before = await styleSeconds();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 60; step += 1) {
    await page.mouse.move(from.x + step * 3, from.y + step * 2);
  }
  await page.mouse.up();
  const seconds = (await styleSeconds()) - before;
  const trace = JSON.parse((await browser.stopTracing()).toString());

  // The passes that restyled the web: a tick touches every node.
  const ticks = trace.traceEvents
    .filter((event) => event.name === 'UpdateLayoutTree' && event.args?.elementCount >= count)
    .map((event) => event.args.elementCount)
    .sort((a, b) => a - b);
  return {
    count,
    perNode: ticks[Math.floor(ticks.length / 2)] / count,
    msPerTick: (seconds * 1000) / ticks.length,
  };
}

const withFix = await measure();
// Take the fix's class off every node link as the page loads, for the "before" run.
await page.addInitScript((fix) => {
  new MutationObserver(() => {
    for (const link of document.querySelectorAll('[data-wiki-node] a')) {
      if (link.className.includes(fix)) link.className = link.className.replace(fix, '');
    }
  }).observe(document, { childList: true, subtree: true });
}, FIX);
const withoutFix = await measure();

/** Hover a node on the settled web and leave it; the most any one style pass restyled. */
async function measureHover() {
  const still = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await still.context().addCookies(await page.context().cookies());
  await still.emulateMedia({ reducedMotion: 'reduce' });
  await still.goto(`${APP}/wiki`);
  const web = still.getByRole('group', { name: /Concepts & entities/ });
  await web.locator('[data-wiki-node] a').first().waitFor();
  const nodes = await web.locator('[data-wiki-node]').count();
  const edges = await web.locator('line').count();
  // A node nothing else covers, so the pointer lands on it.
  const spot = await web.locator('[data-wiki-node] a').evaluateAll((links) => {
    for (const link of links) {
      const box = link.getBoundingClientRect();
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (document.elementFromPoint(at.x, at.y)?.closest('a') === link) return at;
    }
    return null;
  });
  await browser.startTracing(still, { categories: ['devtools.timeline'] });
  await still.mouse.move(spot.x, spot.y);
  await web.and(still.locator('[data-active=true]')).waitFor();
  await still.mouse.move(2, 2);
  await web.and(still.locator(':not([data-active])')).waitFor();
  const trace = JSON.parse((await browser.stopTracing()).toString());
  const largest = Math.max(
    ...trace.traceEvents
      .filter((event) => event.name === 'UpdateLayoutTree')
      .map((event) => event.args?.elementCount ?? 0),
  );
  return { nodes, edges, perElement: largest / (nodes + edges) };
}
const hover = await measureHover();
await browser.close();

const report = (label, { perNode, msPerTick }) => {
  console.log(label);
  console.log(`  elements restyled per tick, per node: ${perNode.toFixed(1)}`);
  console.log(`  style per tick under 5 ms: ${msPerTick < 5 ? 'yes' : 'no'}`);
  console.log(`  style per tick over 10 ms: ${msPerTick > 10 ? 'yes' : 'no'}`);
};
console.log(`nodes on the web: ${withFix.count}`);
report('as built', withFix);
report(`with ${FIX} taken off the node links`, withoutFix);
console.log(`hovering a node, then leaving it (${hover.nodes} nodes, ${hover.edges} edges)`);
console.log(
  `  elements restyled by the largest pass, per node and edge: ${hover.perElement.toFixed(1)}`,
);
