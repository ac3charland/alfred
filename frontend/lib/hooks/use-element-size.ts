'use client';

import * as React from 'react';

/** An element's laid-out size, in CSS pixels. */
export interface ElementSize {
  width: number;
  height: number;
}

/**
 * The size `ref`'s element is laid out at, kept current as it resizes; `undefined` until it
 * has been measured, and while it has no area (hidden, or not laid out yet).
 *
 * A ResizeObserver reports the content box. Without one (an old browser, or a test
 * environment) the element is measured once it has been laid out, and again whenever the
 * window resizes. A report of the size it already has keeps the same object, so an effect
 * that depends on it doesn't run again.
 */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): ElementSize | undefined {
  const [size, setSize] = React.useState<ElementSize>();

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = (width: number, height: number) => {
      setSize((current) => {
        if (width <= 0 || height <= 0) return;
        return current?.width === width && current.height === height ? current : { width, height };
      });
    };

    if (typeof ResizeObserver === 'undefined') {
      const measure = () => {
        const box = element.getBoundingClientRect();
        report(box.width, box.height);
      };
      const frame = requestAnimationFrame(measure);
      globalThis.addEventListener('resize', measure);
      return () => {
        cancelAnimationFrame(frame);
        globalThis.removeEventListener('resize', measure);
      };
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) report(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}
