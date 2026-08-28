import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import {
  DEPARTURE_MS,
  DepartingItemsProvider,
  useDepartingItems,
  useDepartingItemsActions,
} from './departing-items-store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <DepartingItemsProvider>{children}</DepartingItemsProvider>;
}

function useDepartingTest() {
  return { state: useDepartingItems(), actions: useDepartingItemsActions() };
}

/**
 * Force a `prefers-reduced-motion` result for the duration of a test. `restoreMocks`
 * (jest.config) reverts the spy to the jest.setup stub after each test.
 */
function mockReducedMotion(matches: boolean): void {
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  } as unknown as MediaQueryList;
  jest.spyOn(globalThis, 'matchMedia').mockReturnValue(mql);
}

describe('DepartingItemsProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts with nothing departing', () => {
    const { result } = renderHook(useDepartingTest, { wrapper: Wrapper });
    expect(result.current.state.departingIds.size).toBe(0);
  });

  it('flags every id it is given so each row can play its exit at the same time', () => {
    const { result } = renderHook(useDepartingTest, { wrapper: Wrapper });

    act(() => {
      void result.current.actions.depart(['a', 'b', 'c']);
    });

    expect(result.current.state.departingIds.has('a')).toBe(true);
    expect(result.current.state.departingIds.has('b')).toBe(true);
    expect(result.current.state.departingIds.has('c')).toBe(true);
  });

  it('resolves only once the exit animation has run, so the caller commits after it', async () => {
    const { result } = renderHook(useDepartingTest, { wrapper: Wrapper });

    let settled = false;
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.actions.depart(['a']).then(() => {
        settled = true;
      });
    });

    // Still mid-flight one frame before the exit ends.
    await act(async () => {
      jest.advanceTimersByTime(DEPARTURE_MS - 1);
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await pending;
    });
    expect(settled).toBe(true);
  });

  it('clear drops every flag, so a row restored by a rollback renders at rest', () => {
    const { result } = renderHook(useDepartingTest, { wrapper: Wrapper });

    act(() => {
      void result.current.actions.depart(['a']);
    });
    act(() => {
      result.current.actions.clear();
    });

    expect(result.current.state.departingIds.size).toBe(0);
  });

  it('departing nothing resolves immediately and flags nothing', async () => {
    const { result } = renderHook(useDepartingTest, { wrapper: Wrapper });

    await act(async () => {
      await result.current.actions.depart([]);
    });

    expect(result.current.state.departingIds.size).toBe(0);
  });

  it('under reduced motion resolves at once and never flags a row', async () => {
    mockReducedMotion(true);
    const { result } = renderHook(useDepartingTest, { wrapper: Wrapper });

    await act(async () => {
      await result.current.actions.depart(['a']);
    });

    // No animation to play and none to wait on — the caller commits straight away.
    expect(result.current.state.departingIds.size).toBe(0);
  });
});
