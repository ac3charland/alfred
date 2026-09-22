import { act } from '@testing-library/react';

/**
 * Test-only. Hold a `realtime.setAuth` double's next call pending — the session token not read
 * yet, the window a fresh page load opens (ALF-258) — and return the release, which resolves it
 * and flushes whatever join was waiting on it.
 */
export function holdRealtimeAuth(setAuth: jest.Mock<Promise<void>>): () => Promise<void> {
  const held: { release?: () => void } = {};
  setAuth.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      held.release = resolve;
    }),
  );
  return async () => {
    await act(async () => {
      held.release?.();
      await Promise.resolve();
    });
  };
}
