// Renders a spec the way the app's SpecView does — inside <iframe sandbox="" srcdoc>, with
// scripting off — and reports what the template promises: no horizontal scroll, a switcher that
// works without script, a stamp only decision rows can move, and how a #dN link behaves there.
//
//   node capture.mjs <spec.html> <shot-dir|-> [check...]   checks: layout switcher stamp jump
//
// Screenshots go to <shot-dir> ("-" skips them). The page loads its mockup font from
// raw.githubusercontent.com; this sandbox's browser can't verify the egress proxy's certificate,
// so the capture answers that URL with the byte-identical committed file and the headers the real
// response carries (access-control-allow-origin: *, application/octet-stream, nosniff).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

const [specPath, shotDirectory, ...requested] = process.argv.slice(2);
const checks = requested.length > 0 ? requested : ['layout', 'switcher', 'stamp', 'jump'];
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const spec = readFileSync(specPath, 'utf8');
const font = readFileSync(path.join(repoRoot, 'frontend/public/fonts/geist-sans.woff2'));
const APP = 'https://alfred.test/code';

const srcdoc = (html) => html.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const parent = (html, width, height) =>
  `<!DOCTYPE html><meta charset="utf-8"><body style="margin:0"><iframe sandbox="" srcdoc="${srcdoc(html)}" ` +
  `style="display:block;border:0;width:${width}px;height:${height}px"></iframe></body>`;

const browser = await chromium.launch();

async function open(html, { width, height, scheme = 'light' }) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: scheme,
    javaScriptEnabled: false,
    isMobile: width < 500,
  });
  await context.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({
      body: font,
      headers: {
        'access-control-allow-origin': '*',
        'content-type': 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      },
    }),
  );
  await context.route(`${APP}**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: parent(html, width, height) }),
  );
  const page = await context.newPage();
  await page.goto(APP);
  const frame = page.frames()[1];
  await frame.evaluate(() => document.fonts.ready);
  return { context, page, frame };
}

if (checks.includes('layout')) {
  for (const width of [390, 1280]) {
    for (const scheme of ['light', 'dark']) {
      const { context, page, frame } = await open(spec, { width, height: 8000, scheme });
      const m = await frame.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        fold: Math.ceil(document.querySelector('#fold').getBoundingClientRect().bottom),
        font: [...document.fonts].find((face) => face.family === 'Geist')?.status ?? 'none declared',
      }));
      const fits = m.scroll <= m.client ? 'no horizontal scroll' : `OVERFLOWS by ${m.scroll - m.client}px`;
      console.log(`${width}px ${scheme.padEnd(5)}  ${fits}; mockup font Geist: ${m.font}`);
      if (shotDirectory !== '-') {
        await page.screenshot({
          path: path.join(shotDirectory, `brief-${width}-${scheme}.png`),
          clip: { x: 0, y: 0, width, height: m.fold },
          fullPage: true,
        });
      }
      await context.close();
    }
  }
}

if (checks.includes('switcher')) {
  const { context, frame } = await open(spec, { width: 1280, height: 8000 });
  const shown = () =>
    frame.evaluate(() =>
      [...document.querySelectorAll('#p1 [data-opt]')]
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => element.dataset.opt)
        .join(', '),
    );
  console.log(`switcher at rest: ${await shown()} shown`);
  await frame.getByRole('radio', { name: 'Before' }).check();
  console.log(`after picking Before (no script): ${await shown()} shown`);
  if (shotDirectory !== '-') await frame.locator('#p1').screenshot({ path: path.join(shotDirectory, 'switcher-before.png') });
  await context.close();
}

if (checks.includes('stamp')) {
  // Mockups of Radix-built UI carry data-state="open" (menus, dialogs); only a decision row's state
  // may move the masthead stamp.
  const read = (frame) =>
    frame.evaluate(() => {
      const after = (selector) => getComputedStyle(document.querySelector(selector), '::after').content;
      const menu = document.querySelector('#radix-menu h3');
      return `stamp ${after('.stamp')}` + (menu ? `, the mockup's own heading gains ${after('#radix-menu h3')}` : '');
    });
  const radix = spec.replace(/(<div class="app"[^>]*>)/, '$1<div id="radix-menu" data-state="open" hidden><h3>Rename</h3></div>');
  const openRow = spec.replace('<li data-state="settled">', '<li data-state="open">');
  for (const [label, html] of [
    ['as written', spec],
    ['with a data-state="open" menu drawn in a plate', radix],
    ['with its first decision row open', openRow],
  ]) {
    const { context, frame } = await open(html, { width: 1280, height: 900 });
    console.log(`${label}: ${await read(frame)}`);
    await context.close();
  }
}

if (checks.includes('jump')) {
  // The SpecView frame is 28rem tall; a row's tag links to its record, #dN, below the fold.
  for (const [label, html] of [
    ['as written', spec],
    ['with <base href="about:srcdoc">', spec.replace('<head>', '<head>\n<base href="about:srcdoc">')],
  ]) {
    const { context, page, frame } = await open(html, { width: 1280, height: 448 });
    await frame.locator('a.tag[href="#d2"]').click();
    await frame.waitForURL(/#d2$/);
    const after = page.frames()[1];
    const scrolled = await after.evaluate(() => Math.round(window.scrollY) > 0);
    console.log(`#d2 click, ${label}: frame at ${after.url()}, ${scrolled ? 'scrolled to the record' : 'not scrolled'}`);
    await context.close();
  }
}

await browser.close();
