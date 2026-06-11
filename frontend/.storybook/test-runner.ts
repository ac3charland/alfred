import path from 'node:path';

import { type TestRunnerConfig, getStoryContext, waitForPageReady } from '@storybook/test-runner';
import { toMatchImageSnapshot } from 'jest-image-snapshot';

/**
 * Per-story visual-test directives. Atom stories opt into image-snapshot capture by
 * setting `parameters.visualTest`; every other story is skipped (the test-runner still
 * smoke-tests and runs their play functions, just without a screenshot).
 */
interface VisualTestParameters {
  /** CSS selector for the element to screenshot. See `VISUAL_TARGET` in visual-test.tsx. */
  target?: string;
  /** Hover the target with a real pointer (→ CSS `:hover`) before capturing. */
  hover?: boolean;
  /** Move keyboard focus into the story (→ `:focus-visible`) before capturing. */
  focus?: boolean;
}

// Baselines are committed to git next to the frontend workspace. `process.cwd()` is the
// frontend/ dir when `test-storybook` runs (see the package.json scripts).
const customSnapshotsDir = path.join(process.cwd(), '__image_snapshots__');

// Neutralise every animation and transition so each capture is deterministic: the
// Spinner's `animate-spin` would otherwise sit at a random rotation, IconButton's
// `transition-colors` would freeze a half-faded hover colour, and a focused input's
// blinking caret would flicker between runs.
const FREEZE_MOTION = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot });
  },
  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);

    // Autodocs generates a separate "Docs" entry per component that renders every story
    // at once — skip it; we snapshot the individual story entries.
    if (storyContext.tags.includes('docs')) return;

    const visual = (storyContext.parameters as { visualTest?: VisualTestParameters }).visualTest;
    // Only atom stories opt in; leave the rest of the Storybook untouched.
    if (!visual) return;

    await page.addStyleTag({ content: FREEZE_MOTION });

    const target = visual.target ?? '#storybook-root';
    const element = page.locator(target).first();

    if (visual.hover) {
      // `userEvent.hover` in a play function dispatches pointer events but does NOT
      // trigger the CSS `:hover` pseudo-class — only a real pointer move does. So hover
      // here, in the test-runner, where Playwright moves the actual mouse.
      await element.hover();
    }
    if (visual.focus) {
      // `:focus-visible` only matches keyboard-driven focus, so Tab into the story (each
      // focus story renders a single focusable control) rather than calling `.focus()`,
      // which yields a plain `:focus` with no ring.
      await page.keyboard.press('Tab');
    }

    await waitForPageReady(page);

    const image = await element.screenshot();
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir,
      customSnapshotIdentifier: context.id,
      // Tolerate sub-pixel antialiasing differences between the sandbox Chromium and
      // CI's Playwright Chromium without masking real changes: a tone/hover/focus
      // regression moves far more than 1% of a component-tight crop.
      failureThreshold: 0.01,
      failureThresholdType: 'percent',
    });
  },
};

export default config;
