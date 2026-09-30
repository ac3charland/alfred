import { act, renderHook } from '@testing-library/react';

import { useElementSize } from './use-element-size';

/** Every ResizeObserver built in a test, so the test can report a size through it. */
class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.made.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }

  /** Report that every observed element's content box is now `width` × `height`. */
  resize(width: number, height: number): void {
    const entries = [...this.observed].map(
      (target) => ({ target, contentRect: { width, height } }) as unknown as ResizeObserverEntry,
    );
    this.callback(entries, this);
  }
}

/** A ref to a fresh element, held for the whole test as a component would hold one. */
const refTo = (element: HTMLElement = document.createElement('div')) => ({ current: element });

const latestObserver = (): FakeResizeObserver => {
  const observer = FakeResizeObserver.made.at(-1);
  if (!observer) throw new Error('no ResizeObserver was made');
  return observer;
};

describe('useElementSize', () => {
  const { ResizeObserver: realResizeObserver } = globalThis;

  beforeEach(() => {
    FakeResizeObserver.made = [];
    globalThis.ResizeObserver = FakeResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = realResizeObserver;
  });

  it('is unknown until the element has been measured', () => {
    const ref = refTo();

    const { result } = renderHook(() => useElementSize(ref));

    expect(result.current).toBeUndefined();
    expect(latestObserver().observed).toContain(ref.current);
  });

  it("follows the element's content box as it resizes", () => {
    const ref = refTo();
    const { result } = renderHook(() => useElementSize(ref));

    act(() => {
      latestObserver().resize(1184, 760);
    });
    expect(result.current).toEqual({ width: 1184, height: 760 });

    act(() => {
      latestObserver().resize(800, 600);
    });
    expect(result.current).toEqual({ width: 800, height: 600 });
  });

  it('keeps the same size object when a report repeats it, so nothing downstream re-runs', () => {
    const ref = refTo();
    const { result } = renderHook(() => useElementSize(ref));
    act(() => {
      latestObserver().resize(1184, 760);
    });
    const first = result.current;

    act(() => {
      latestObserver().resize(1184, 760);
    });

    expect(result.current).toBe(first);
  });

  it('reads an element with no area — hidden, or not laid out — as unmeasured', () => {
    const ref = refTo();
    const { result } = renderHook(() => useElementSize(ref));
    act(() => {
      latestObserver().resize(1184, 760);
    });

    act(() => {
      latestObserver().resize(0, 760);
    });

    expect(result.current).toBeUndefined();
  });

  it('stops observing once unmounted', () => {
    const ref = refTo();
    const { unmount } = renderHook(() => useElementSize(ref));

    unmount();

    expect(latestObserver().disconnected).toBe(true);
  });

  describe('where there is no ResizeObserver', () => {
    beforeEach(() => {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    });

    it('measures the element once it has been laid out, and again when the window resizes', () => {
      const frames: FrameRequestCallback[] = [];
      jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const element = document.createElement('div');
      const box = jest
        .spyOn(element, 'getBoundingClientRect')
        .mockReturnValue({ width: 1184, height: 760 } as DOMRect);
      const ref = refTo(element);
      const { result } = renderHook(() => useElementSize(ref));
      expect(result.current).toBeUndefined();

      act(() => {
        for (const frame of frames) frame(0);
      });
      expect(result.current).toEqual({ width: 1184, height: 760 });

      box.mockReturnValue({ width: 640, height: 480 } as DOMRect);
      act(() => {
        globalThis.dispatchEvent(new Event('resize'));
      });
      expect(result.current).toEqual({ width: 640, height: 480 });
    });

    it('stops listening to the window once unmounted', () => {
      const element = document.createElement('div');
      const box = jest
        .spyOn(element, 'getBoundingClientRect')
        .mockReturnValue({ width: 1184, height: 760 } as DOMRect);
      const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame');
      const ref = refTo(element);
      const { unmount } = renderHook(() => useElementSize(ref));

      unmount();
      globalThis.dispatchEvent(new Event('resize'));

      expect(cancel).toHaveBeenCalled();
      expect(box).not.toHaveBeenCalled();
    });
  });
});
