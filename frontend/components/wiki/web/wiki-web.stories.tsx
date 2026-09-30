import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';

import { resetWikiFixtureClock, toWikiIndexRow, wikiWebFixtureSet } from '@/lib/wiki/fixtures';
import { buildWikiWeb } from '@/lib/wiki/web/graph';

import { WikiWeb } from './wiki-web';

/**
 * The landing's web over the 52-page sample, one story per state: at rest on the day's concept,
 * zoomed past 1:1, with no focus, a single node, and hovering an entity. Every story forces
 * reduced motion, so the seeded physics settles before its one paint and the capture is the same
 * on every run.
 */

resetWikiFixtureClock();
const SAMPLE = buildWikiWeb(wikiWebFixtureSet().pages.map((page) => toWikiIndexRow(page)));
const FOCUS = 'wiki/concepts/desirable-difficulty.md';

/** The landing's content column: 736 px of web inside the shell's padding. */
const withFrame: Decorator = (Story) => (
  <div data-testid="web-frame" className="w-[768px] bg-background p-4">
    <h3 id="web-heading" className="sr-only">
      Concepts & entities
    </h3>
    <Story />
  </div>
);

const meta = {
  title: 'Wiki/WikiWeb',
  component: WikiWeb,
  decorators: [withFrame],
  args: {
    nodes: SAMPLE.nodes,
    edges: SAMPLE.edges,
    focusPath: FOCUS,
    labelledBy: 'web-heading',
    reducedMotion: true,
  },
  parameters: {
    nextjs: { appDirectory: true },
    visualTest: { target: '[data-testid="web-frame"]' },
  },
} satisfies Meta<typeof WikiWeb>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The day's concept pulled to the middle, glowing, its six neighbours lit violet and named. */
export const AtRest: Story = {};

/**
 * Pinched in past 1:1 about the middle: every name that fits shows, the dots keep their size,
 * and the Fit button offers the whole web back.
 */
export const ZoomedIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The nodes join the accessibility tree once the stage is measured and the web laid out; a
    // zoom before then would be handed straight back to the fit.
    await canvas.findByRole('link', { name: 'John Medina, entity' });
    const stage = canvas.getByRole('group', { name: 'Concepts & entities' });
    const box = stage.getBoundingClientRect();
    const middle = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    for (let turn = 0; turn < 2; turn += 1) {
      await fireEvent.wheel(stage, { deltaY: -30, ctrlKey: true, ...middle });
    }
    await expect(await canvas.findByRole('button', { name: 'Fit the web' })).toBeInTheDocument();
  },
};

/** The web with no day's concept to open on: nothing pulled, nothing lit, nothing named. */
export const NoFocus: Story = {
  args: { focusPath: null },
};

/** A wiki of one concept: its dot at the middle, at 1:1, named. */
export const OneNode: Story = {
  args: {
    nodes: SAMPLE.nodes
      .filter((node) => node.path === FOCUS)
      .map((node) => ({ ...node, degree: 0 })),
    edges: [],
  },
};

/**
 * Hovering John Medina lights his neighbourhood and dims the rest; the day's concept keeps its
 * halo and name. The web lights from pointer events, not CSS `:hover`, so the play function's
 * hover is enough. Declared last: nothing after it should inherit a pointer left on a node.
 */
export const Hovering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Found once the stage is measured and the web laid out.
    const medina = await canvas.findByRole('link', { name: 'John Medina, entity' });
    await userEvent.hover(medina);
    await waitFor(async () => {
      await expect(medina.closest('[data-wiki-node]')).toHaveAttribute('data-state', 'lit');
    });
  },
};
