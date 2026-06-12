import type { Page } from '@playwright/test';

/**
 * Runtime probe — sample a value from a live page once per animation frame.
 *
 * This is a NON-INVASIVE debugger: it adds nothing to the app. A sampling loop is
 * injected into the running page via `page.evaluate`, reads a value each frame
 * into a page-global array, and the array is pulled back to Node. Because it
 * drives the real browser, it captures the transient frames BETWEEN a transition's
 * start and end states — a one-frame flash, layout jank, an animation restart —
 * that final-state assertions and jsdom can't see.
 *
 * Two modes share these primitives:
 *   - debug: print `formatTimeline(frames)` to eyeball what happened frame by frame.
 *   - guard: assert over the frames in an e2e test (see e2e/inbox-fade.spec.ts).
 */

export type ProbeRead =
  | { kind: 'style'; props: string[] }
  | {
      kind: 'rect';
      props: ('x' | 'y' | 'width' | 'height' | 'top' | 'right' | 'bottom' | 'left')[];
    }
  | { kind: 'attr'; names: string[] };

export interface ProbeOptions {
  /** CSS selector for the element to watch — re-queried every frame. */
  selector: string;
  /** What to read off the element each frame. */
  read: ProbeRead;
  /** Sampling window in ms — make it bracket the whole transition. */
  durationMs: number;
}

export interface ProbeFrame {
  /** ms since sampling started. */
  t: number;
  /** The read values, or `null` when the element is absent (e.g. it unmounted). */
  values: Record<string, string | number> | null;
}

/** Page-global state for one sampling run: the frames plus a completion flag. */
interface ProbeState {
  frames: ProbeFrame[];
  done: boolean;
}

const PROBE_KEY = '__runtimeProbe';

/** Start an rAF sampling loop in the page and return at once (fire-and-forget). */
export async function startSampling(page: Page, options: ProbeOptions): Promise<void> {
  await page.evaluate(
    ({ selector, read, durationMs, key }) => {
      const state: ProbeState = { frames: [], done: false };
      (globalThis as unknown as Record<string, ProbeState>)[key] = state;
      const frames = state.frames;
      const start = performance.now();
      const readValues = (element: Element): Record<string, string | number> => {
        if (read.kind === 'style') {
          const computed = getComputedStyle(element);
          return Object.fromEntries(
            read.props.map((property): [string, string | number] => [
              property,
              computed.getPropertyValue(property),
            ]),
          );
        }
        if (read.kind === 'rect') {
          const rect = element.getBoundingClientRect();
          return Object.fromEntries(
            read.props.map((property): [string, number] => [property, rect[property]]),
          );
        }
        return Object.fromEntries(
          read.names.map((name): [string, string] => [name, element.getAttribute(name) ?? '']),
        );
      };
      const tick = () => {
        const element = document.querySelector(selector);
        frames.push({
          t: Math.round(performance.now() - start),
          values: element ? readValues(element) : null,
        });
        if (performance.now() - start < durationMs) requestAnimationFrame(tick);
        else state.done = true;
      };
      requestAnimationFrame(tick);
    },
    { ...options, key: PROBE_KEY },
  );
}

/** Read back the frames recorded by `startSampling`. */
export async function collectSamples(page: Page): Promise<ProbeFrame[]> {
  return page.evaluate(
    (key) => (globalThis as unknown as Record<string, ProbeState | undefined>)[key]?.frames ?? [],
    PROBE_KEY,
  );
}

/**
 * Sample across an action: start the loop, run `trigger` while it samples, wait
 * for the sampling window to elapse (the loop's own completion flag, not a fixed
 * timeout), then return the frames. The common case — measure what happens to an
 * element DURING a click/navigation.
 */
export async function sampleDuring(
  page: Page,
  options: ProbeOptions,
  trigger: () => Promise<void>,
): Promise<ProbeFrame[]> {
  await startSampling(page, options);
  await trigger();
  await page.waitForFunction(
    (key) => (globalThis as unknown as Record<string, ProbeState | undefined>)[key]?.done === true,
    PROBE_KEY,
  );
  return collectSamples(page);
}

/** Render frames as a readable, deterministic timeline for debug output / demo docs. */
export function formatTimeline(frames: ProbeFrame[]): string {
  return frames
    .map((frame) => {
      const body =
        frame.values === null
          ? 'GONE'
          : Object.entries(frame.values)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join('  ');
      return `t=${String(frame.t).padStart(4, ' ')}ms  ${body}`;
    })
    .join('\n');
}
