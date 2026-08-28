import { expect, test } from './support/fixtures';
import { type ProbeFrame, sampleDuring, translateXOf } from './support/probe';

/**
 * Regression guard for the inbox-capture "ghost" flourish.
 *
 * On capture, CaptureBox spawns a transient copy of the just-typed text that fades and
 * slides to the right (the shared `animate-send-off` token, which a dispatched Inbox row
 * leaves on too), then removes itself on `animationend`. jsdom runs no CSS animations, so
 * the unit tests can only assert the markup; here we sample the ghost's real computed
 * opacity + transform every frame to prove it actually fades, actually slides right, and
 * ultimately unmounts.
 */

test('captured text fades and slides right, then unmounts', async ({ page }) => {
  await page.goto('/');
  const textarea = page.getByRole('combobox', { name: 'Capture box' });
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
  const offsets = present.map((frame) => translateXOf(String(frame.values?.['transform'])));
  expect(Math.max(...offsets)).toBeGreaterThan(8);

  // It ultimately unmounted (null = GONE) — the animationend cleanup ran.
  expect(frames.at(-1)?.values).toBeNull();
});
