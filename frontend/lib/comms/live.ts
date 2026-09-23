/**
 * How the Comms view decides whether it is a live reflection of the server, now that it polls
 * `GET /api/comms/snapshot` instead of holding a Realtime subscription.
 *
 * Every source the module mirrors is minutes-granular (the Gmail poll every 3 minutes, the
 * classifier sweep every 2, the Mac daemon roughly once a minute), so a socket bought almost
 * nothing over polling — and it cost the machinery that kept it honest. Liveness is now pure
 * recency: a read that started recently enough is trusted, and one that didn't isn't. There is
 * no event to miss firing and no channel state to fall out of sync with — a dead network or a
 * frozen tab shows up the moment anything re-renders, because the check is just a subtraction
 * against `now`. A machine actually asleep is its own case: JS timers are monotonic and don't run
 * while suspended, so nothing re-renders on its own to notice the wall clock jumped — `useCommsLive`
 * (`lib/hooks/use-comms-live.ts`) covers that by re-checking on `visibilitychange`/`pageshow`.
 */

/** How often the Comms view re-reads the snapshot while the tab is visible. */
export const COMMS_POLL_MS = 30_000;

/**
 * How long a successful read stays trustworthy. Two polls' worth absorbs one missed tick (a slow
 * response, a request that timed out) without the view flapping between live and not; the extra
 * five seconds is slack for the read itself, not another poll.
 */
export const COMMS_LIVE_WINDOW_MS = 2 * COMMS_POLL_MS + 5000;

/**
 * Is the Comms view a live reflection of the server right now? `loaded` is false only while the
 * shell's own seed read failed and no read has landed since — nothing to date, so never live.
 * Otherwise it's live iff the last successful read started within {@link COMMS_LIVE_WINDOW_MS} of
 * `now`.
 */
export function isCommsLive(loaded: boolean, lastReadAt: string | null, now: Date): boolean {
  if (!loaded || lastReadAt === null) return false;
  return now.getTime() - Date.parse(lastReadAt) <= COMMS_LIVE_WINDOW_MS;
}
