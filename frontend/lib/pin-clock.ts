/**
 * Test-only clock pin. A fixture built from `new Date()`, `Date.now()`, or `todayIn(...)`'s
 * default parameter is only as stable as the moment the suite happens to run — a "not yet
 * started" habit dated tomorrow, or a day-of-week check, silently flips answers on the calendar
 * date (or weekday) this file assumed at write time. {@link pinClock} fakes `Date` to a fixed
 * instant so the code under test and the test's own fixtures always read the same "now",
 * forever — not just derive from the clock the same way, which still depends on when the suite
 * runs.
 *
 * This replaces `Date` with a `Proxy` rather than using `jest.useFakeTimers()`: Jest's fake
 * timers wrap `Intl.DateTimeFormat` too (whenever `Intl` is present, which jsdom provides), and
 * that fake `Intl.DateTimeFormat` builds each formatter's `resolvedOptions`/`format` methods as
 * OWN properties of the returned instance, not on `Intl.DateTimeFormat.prototype` — so a test
 * that legitimately spies on that prototype (to force a specific browser timezone, say) stops
 * intercepting anything the instant `Date` is faked. Mocking only `Date` sidesteps this
 * entirely; `Intl` is never touched.
 */

let fixedMs = 0;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const RealDate = globalThis.Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      return args.length === 0 ? new target(fixedMs) : (Reflect.construct(target, args) as object);
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => fixedMs;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  afterAll(() => {
    globalThis.Date = RealDate;
  });
}

/**
 * Sets the instant `new Date()` and `Date.now()` resolve to, from now until the next reset.
 * `new Date(anything)` — an explicit ISO string, epoch ms, etc. — is unaffected; only the
 * zero-argument, "what time is it" form is faked.
 *
 * Call it inside a single test to shift just that test's "now" (e.g. to a specific weekday) —
 * {@link pinClock}'s `beforeEach` restores the file's pinned instant before the next test runs,
 * so the override never leaks.
 */
export function setClockNow(now: string): void {
  fixedMs = new Date(now).getTime();
}

/**
 * Pins every test in the file to a fixed instant. Call it once, synchronously, at the top of
 * the file — right after the imports, before any module-level fixture reads the clock — so the
 * pin is already active when those constants evaluate, not just once the first test starts.
 */
export function pinClock(now: string): void {
  install();
  setClockNow(now);
  beforeEach(() => {
    setClockNow(now);
  });
}
