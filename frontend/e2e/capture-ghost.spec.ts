import { expect, test } from './support/fixtures';
import { type ProbeFrame, sampleDuring } from './support/probe';

/**
 * Regression guard for the inbox-capture "ghost" flourish.
 *
 * On capture, CaptureBox spawns a transient copy of the just-typed text that fades and
 * slides to the right (animate-out fade-out-0 slide-out-to-right-8), then removes itself
 * on `animationend`. jsdom runs no CSS animations, so the unit tests can only assert the
 * markup; here we sample the ghost's real computed opacity + transform every frame to
 * prove it actually fades, actually slides right, and ultimately unmounts.
 */

/** Pull the translateX (5th value) out of a computed `matrix(...)` transform string. */
function translateX(transform: string): number {
  const match = /matrix\(([^)]+)\)/.exec(transform);
  const group = match?.[1];
  if (group === undefined) return 0;
  const parts = group.split(',').map((value) => Number(value.trim()));
  return parts[4] ?? 0;
}

test('captured text fades and slides right, then unmounts', async ({ page }) => {
  await page.goto('/');
  const textarea = page.getByRole('textbox', { name: 'Capture box' });
  await textarea.fill('A fleeting thought');

  const frames: ProbeFrame[] = await sampleDuring(
    page,
    {
      selector: '[data-testid="capture-ghost"]',
      read: { kind: 'style', props: ['opacity', 'transform'] },
      durationMs: 800,
    },
    () => textarea.press('Enter'),
  );

  // The ghost was actually present for some frames.
  const present = frames.filter((frame) => frame.values !== null);
  expect(present.length).toBeGreaterThan(0);

  // It faded: opacity dropped toward 0 (held there by fill-mode-forwards).
  const opacities = present.map((frame) => Number(frame.values?.['opacity']));
  expect(Math.min(...opacities)).toBeLessThan(0.5);

  // It slid right: translateX grew positively as it left the box.
  const offsets = present.map((frame) => translateX(String(frame.values?.['transform'])));
  expect(Math.max(...offsets)).toBeGreaterThan(8);

  // It ultimately unmounted (null = GONE) — the animationend cleanup ran.
  expect(frames.at(-1)?.values).toBeNull();
});
