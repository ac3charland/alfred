import { act, renderHook } from '@testing-library/react';

import { useVisualViewport } from './use-visual-viewport';

/** A stand-in for `window.visualViewport`: an event target whose readings the test sets. */
class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
}

function installVisualViewport(viewport: FakeVisualViewport | undefined) {
  Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
}

afterEach(() => {
  installVisualViewport(undefined);
});

describe('useVisualViewport', () => {
  it('is null where the API is absent (older browsers, the server)', () => {
    installVisualViewport(undefined);

    const { result } = renderHook(() => useVisualViewport());

    expect(result.current).toBeNull();
  });

  it("reads the visible viewport's height and offset", () => {
    const viewport = new FakeVisualViewport();
    viewport.height = 470;
    viewport.offsetTop = 12;
    installVisualViewport(viewport);

    const { result } = renderHook(() => useVisualViewport());

    expect(result.current).toEqual({ height: 470, offsetTop: 12 });
  });

  it('updates when the viewport resizes (the keyboard rising)', () => {
    const viewport = new FakeVisualViewport();
    installVisualViewport(viewport);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: 844, offsetTop: 0 });

    act(() => {
      viewport.height = 470;
      viewport.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toEqual({ height: 470, offsetTop: 0 });
  });

  it('updates when the viewport scrolls (iOS panning it to a focused field)', () => {
    const viewport = new FakeVisualViewport();
    installVisualViewport(viewport);
    const { result } = renderHook(() => useVisualViewport());

    act(() => {
      viewport.offsetTop = 120;
      viewport.dispatchEvent(new Event('scroll'));
    });

    expect(result.current).toEqual({ height: 844, offsetTop: 120 });
  });

  it('hands back the same object for identical readings, so a no-op event never re-renders', () => {
    const viewport = new FakeVisualViewport();
    installVisualViewport(viewport);
    const { result } = renderHook(() => useVisualViewport());
    const first = result.current;

    act(() => {
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    });

    expect(result.current).toBe(first);
  });

  it('stops listening on unmount', () => {
    const viewport = new FakeVisualViewport();
    const removeEventListener = jest.spyOn(viewport, 'removeEventListener');
    installVisualViewport(viewport);
    const { unmount } = renderHook(() => useVisualViewport());

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
