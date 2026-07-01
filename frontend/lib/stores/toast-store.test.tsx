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

describe('ToastProvider', () => {
  beforeEach(() => {
    mockPlayToastSound.mockClear();
    setReducedMotion(false);
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
});
