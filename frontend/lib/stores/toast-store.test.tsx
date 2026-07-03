import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import { playToastSound } from '@/lib/play-toast-sound';

import { ToastProvider, useToastActions, useToasts } from './toast-store';

// The sound helper is the seam; mock it so tests assert *whether* a chime fires without
// touching Web Audio.
jest.mock('@/lib/play-toast-sound');
const mockPlayToastSound = jest.mocked(playToastSound);

// Matches the store's EXIT_MS / DISMISS_MS; kept local so the timer math reads clearly.
const EXIT_MS = 200;
const DISMISS_MS = 4000;

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function useToastTest() {
  return { toasts: useToasts(), actions: useToastActions() };
}

/** Override matchMedia for one test to report a `prefers-reduced-motion: reduce` match. */
function setReducedMotion(matches: boolean) {
  globalThis.matchMedia = (query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }) as unknown as MediaQueryList;
}

/**
 * Simulate the tab backgrounding / foregrounding: `document.hidden` is a read-only getter in
 * jsdom, so shadow it, then fire the event the store listens to (`visibilitychange`, or
 * `focus` on the window when the tab regains focus).
 */
function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
  if (!hidden) globalThis.dispatchEvent(new Event('focus'));
}

describe('ToastProvider', () => {
  beforeEach(() => {
    mockPlayToastSound.mockClear();
    setReducedMotion(false);
  });

  afterEach(() => {
    // Reset the tab to visible so a hidden-tab test can't leak into the next one.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  describe('variant', () => {
    it('defaults the variant to "default"', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]).toMatchObject({
        message: 'Created ALF-42',
        variant: 'default',
        leaving: false,
      });
    });

    it('stores the "emphasis" variant when passed', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('ALF-42 moved to Ready for Dev', 'emphasis');
      });

      expect(result.current.toasts[0]?.variant).toBe('emphasis');
    });
  });

  describe('href', () => {
    it('stores an href when passed, making the toast a clickable nav target', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42', 'default', '/code/p1?story=ALF-42');
      });

      expect(result.current.toasts[0]).toMatchObject({
        message: 'Created ALF-42',
        href: '/code/p1?story=ALF-42',
      });
    });

    it('leaves href absent when none is passed', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });

      expect(result.current.toasts[0]?.href).toBeUndefined();
    });
  });

  describe('sound', () => {
    it('plays the chime once for an emphasis toast', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('ALF-42 moved to Ready for Dev', 'emphasis');
      });

      expect(mockPlayToastSound).toHaveBeenCalledTimes(1);
    });

    it('does not play a sound for a default toast', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });

      expect(mockPlayToastSound).not.toHaveBeenCalled();
    });

    it('stays silent for an emphasis toast under prefers-reduced-motion', () => {
      setReducedMotion(true);
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('ALF-42 moved to Ready for Dev', 'emphasis');
      });

      expect(mockPlayToastSound).not.toHaveBeenCalled();
    });
  });

  describe('two-phase dismissal', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('marks the toast leaving, then removes it after EXIT_MS', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });
      const id = result.current.toasts[0]?.id ?? '';

      act(() => {
        result.current.actions.dismissToast(id);
      });
      // Still in the queue, but flagged leaving so the viewport can animate it out.
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.leaving).toBe(true);

      act(() => {
        jest.advanceTimersByTime(EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(0);
    });

    it('auto-expiry goes through the same leaving → remove path', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });

      act(() => {
        jest.advanceTimersByTime(DISMISS_MS);
      });
      // The auto-dismiss timer marks it leaving, not gone.
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.leaving).toBe(true);

      act(() => {
        jest.advanceTimersByTime(EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(0);
    });

    it('is idempotent when dismissing an already-leaving toast', () => {
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });
      const id = result.current.toasts[0]?.id ?? '';

      act(() => {
        result.current.actions.dismissToast(id);
        result.current.actions.dismissToast(id);
      });
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.leaving).toBe(true);

      act(() => {
        jest.advanceTimersByTime(EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(0);
    });
  });

  describe('visibility-gated auto-dismiss', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('does not start the countdown while the tab is hidden — the toast stays', () => {
      setTabHidden(true);
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
      });

      // Well past the auto-dismiss window, but the timer never started: the toast is untouched.
      act(() => {
        jest.advanceTimersByTime(DISMISS_MS + EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.leaving).toBe(false);
    });

    it('starts the countdown when the tab regains focus, then dismisses', () => {
      setTabHidden(true);
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
        jest.advanceTimersByTime(DISMISS_MS + EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(1);

      // Tab comes back: the fresh countdown starts now.
      act(() => {
        setTabHidden(false);
      });
      act(() => {
        jest.advanceTimersByTime(DISMISS_MS);
      });
      expect(result.current.toasts[0]?.leaving).toBe(true);

      act(() => {
        jest.advanceTimersByTime(EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(0);
    });

    it('cancels a running countdown when the tab goes hidden, so nothing clears while away', () => {
      // Tab starts visible (jsdom default), so showToast begins the countdown immediately.
      const { result } = renderHook(useToastTest, { wrapper: Wrapper });

      act(() => {
        result.current.actions.showToast('Created ALF-42');
        jest.advanceTimersByTime(DISMISS_MS - 1000);
      });
      expect(result.current.toasts[0]?.leaving).toBe(false);

      // Tab hides part-way through: the countdown is cancelled and the toast is parked.
      act(() => {
        setTabHidden(true);
        jest.advanceTimersByTime(DISMISS_MS + EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0]?.leaving).toBe(false);

      // Refocusing restarts a full countdown from scratch.
      act(() => {
        setTabHidden(false);
      });
      act(() => {
        jest.advanceTimersByTime(DISMISS_MS + EXIT_MS);
      });
      expect(result.current.toasts).toHaveLength(0);
    });
  });
});
