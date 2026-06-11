import type { Decorator } from '@storybook/nextjs';
import * as React from 'react';

/**
 * CSS selector for the element the visual-regression test-runner screenshots
 * (see `.storybook/test-runner.ts`). Atom stories set `parameters.visualTest.target`
 * to this value so the captured image is a tight crop of the atom on the dark theme —
 * not the full canvas, where a small icon change would be lost in a sea of background.
 */
export const VISUAL_TARGET = '[data-testid="visual-frame"]';

/**
 * Wrap a story in a shrink-wrapped, padded frame tagged for visual capture. The padding
 * leaves room for the `focus-visible` ring, which draws *outside* the element's border
 * box and would otherwise be clipped by an element-tight screenshot. Add it to an atom's
 * `meta.decorators` and point `parameters.visualTest.target` at {@link VISUAL_TARGET}.
 */
export const withVisualFrame: Decorator = (Story) => (
  <div data-testid="visual-frame" className="inline-flex p-3">
    <Story />
  </div>
);
