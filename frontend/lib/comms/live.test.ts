import { COMMS_LIVE_WINDOW_MS, COMMS_POLL_MS, isCommsLive } from './live';

/**
 * The whole liveness rule the queue view and header trust: recency, not an event log. Nothing
 * here dispatches a store action or fires a timer — a dead socket can't fake a false all-clear
 * because there is no socket, and a frozen tab can't fake a false all-clear because the check is
 * just a subtraction against `now`.
 */

const NOW = new Date('2026-09-09T12:00:00.000Z');

/** An ISO instant `ms` before {@link NOW}. */
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('isCommsLive', () => {
  it('is not live before anything has ever loaded', () => {
    expect(isCommsLive(false, null, NOW)).toBe(false);
  });

  it('is not live once loaded but with no read to date it by', () => {
    expect(isCommsLive(true, null, NOW)).toBe(false);
  });

  it('is live right after a read lands', () => {
    expect(isCommsLive(true, before(0), NOW)).toBe(true);
  });

  it('stays live up to and including the edge of the window', () => {
    expect(isCommsLive(true, before(COMMS_LIVE_WINDOW_MS), NOW)).toBe(true);
  });

  it('goes not live the instant the last read is older than the window', () => {
    expect(isCommsLive(true, before(COMMS_LIVE_WINDOW_MS + 1), NOW)).toBe(false);
  });

  it('sizes the window to survive one missed poll without flapping', () => {
    // A single dropped poll (2×) still reads as live; two in a row does not.
    expect(isCommsLive(true, before(COMMS_POLL_MS), NOW)).toBe(true);
    expect(COMMS_LIVE_WINDOW_MS).toBeGreaterThan(COMMS_POLL_MS * 2);
    expect(COMMS_LIVE_WINDOW_MS).toBeLessThan(COMMS_POLL_MS * 3);
  });
});
