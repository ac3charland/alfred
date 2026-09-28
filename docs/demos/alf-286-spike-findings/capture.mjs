// Renders a findings document the way the app's spec view does — inside <iframe sandbox="" srcdoc>,
// with scripting off — and reports what the findings template promises: no horizontal scroll at a
// phone or desktop width in either scheme, a brief within its 300-word prose budget, and a freeform
// detail whose sections number themselves.
//
//   node capture.mjs <findings.html> <shot-dir|->     "-" skips the screenshots
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

const [findingsPath, shotDirectory] = process.argv.slice(2);
const findings = readFileSync(findingsPath, 'utf8');
const APP = 'https://alfred.test/code';
const shoot = shotDirectory !== '-';

const srcdoc = (html) => html.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const parent = (html, width, height) =>
  `<!DOCTYPE html><meta charset="utf-8"><body style="margin:0"><iframe sandbox="" srcdoc="${srcdoc(html)}" ` +
  `style="display:block;border:0;width:${width}px;height:${height}px"></iframe></body>`;

const browser = await chromium.launch();

async function open({ width, scheme }) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: scheme,
    javaScriptEnabled: false,
    isMobile: width < 500,
  });
  await context.route(`${APP}**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: parent(findings, width, 9000) }),
  );
  const page = await context.newPage();
  await page.goto(APP);
  return { context, page, frame: page.frames()[1] };
}

for (const width of [390, 1280]) {
  for (const scheme of ['light', 'dark']) {
    const { context, page, frame } = await open({ width, scheme });
    const m = await frame.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      fold: document.querySelector('#fold').getBoundingClientRect(),
    }));
    const fits = m.scroll <= m.client ? 'no horizontal scroll' : `OVERFLOWS by ${m.scroll - m.client}px`;
    console.log(`${width}px ${scheme.padEnd(5)}  ${fits}`);
    if (shoot) {
      await page.screenshot({
        path: path.join(shotDirectory, `brief-${width}-${scheme}.png`),
        clip: { x: 0, y: 0, width, height: Math.ceil(m.fold.bottom) },
        fullPage: true,
      });
      if (width === 1280 && scheme === 'light') {
        await page.screenshot({
          path: path.join(shotDirectory, 'detail-1280-light.png'),
          clip: { x: 0, y: Math.floor(m.fold.top), width, height: 1700 },
          fullPage: true,
        });
      }
    }
    await context.close();
  }
}

const { context, frame } = await open({ width: 1280, scheme: 'light' });
const report = await frame.evaluate(() => {
  const words = (selector) =>
    [...document.querySelectorAll(selector)]
      .flatMap((element) => element.textContent.split(/\s+/))
      .filter((word) => /\w/.test(word)).length;
  const sections = [...document.querySelectorAll('#detail > section > h2')].map((heading) => heading.textContent);
  return { answer: words('#answer'), landed: words('#landed > :not(.side)'), sections };
});
console.log(`brief prose: ${report.answer + report.landed} words (#answer ${report.answer}, #landed ${report.landed}); the figure is uncounted`);
console.log(`below the fold, in the author's own order:\n  ${report.sections.join('\n  ')}`);
await context.close();
await browser.close();
