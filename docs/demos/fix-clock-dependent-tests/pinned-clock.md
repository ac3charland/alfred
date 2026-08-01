---
branch: claude/fix-clock-dependent-tests
---

# Pin the test clock instead of deriving fixtures from it

*2026-08-01T22:50:51.333Z*

`frontend/lib/stores/habits-store.test.tsx` had a hardcoded fixture, `started_on: '2026-08-01'`,
asserted to be "the future." It was written when today was well before that date; today's real
date caught up to it and the test started failing. A second, latent bug a few lines up hardcodes
`active_days: [1]` (Mondays-only) and asserts today is not a Monday — true on six days out of
seven, and due to fail the next time a Monday rolls around.

Both bugs share one root cause: the fixture's notion of "today" depends on when the suite happens
to run. The fix in `frontend/lib/pin-clock.ts` pins `Date` to a fixed instant for the file, so a
literal like `'2026-08-01'` is safe forever, not just on the day it was written.

This is pure test infrastructure with no UI, so the evidence below calls the real
`pinClock`/`setClockNow` functions directly (no test runner) and contrasts the result against the
OLD pattern — deriving "today" from whatever the clock says right now via `todayIn(...)`, with no
pin at all.

```bash
cat > /tmp/clock-demo-drift.mjs <<'JS'
globalThis.beforeEach = () => {};
globalThis.afterAll = () => {};

const root = process.cwd();
const { todayIn } = await import(root + '/frontend/lib/habits/dates.ts');
const { pinClock } = await import(root + '/frontend/lib/pin-clock.ts');

// Stand in for "whichever real moment the suite happens to run at" -- pinClock IS the real
// clock-mocking primitive this repo uses, so driving it here reproduces the old bug exactly.
const SIMULATED_RUNS = ['2020-01-01T00:00:00.000Z', '2026-07-28T09:00:00.000Z', '2030-12-31T23:00:00.000Z'];

for (const runAt of SIMULATED_RUNS) {
  pinClock(runAt);
  const today = todayIn('UTC');
  console.log(`suite runs at ${runAt} -> derived today = ${today}, "2026-08-01" reads as future: ${'2026-08-01' > today}`);
}
JS
node /tmp/clock-demo-drift.mjs 2>/dev/null
```

```output
suite runs at 2020-01-01T00:00:00.000Z -> derived today = 2020-01-01, "2026-08-01" reads as future: true
suite runs at 2026-07-28T09:00:00.000Z -> derived today = 2026-07-28, "2026-08-01" reads as future: true
suite runs at 2030-12-31T23:00:00.000Z -> derived today = 2030-12-31, "2026-08-01" reads as future: false
```

The comparison flips from `true` to `false` on the third simulated run — exactly the failure that
hit `habits-store.test.tsx`: a literal written to be "the future" silently becomes "the past" the
moment the real (or simulated) clock reaches it. Deriving the fixture from `todayIn(...)` instead
of hardcoding it, the fix this codebase used to reach for, only delays this: it is still tied to
whatever "now" happens to be.

Now the fix — `pinClock` from `frontend/lib/pin-clock.ts`, called with a genuinely fixed instant
after the "suite" has already started:

```bash
cat > /tmp/clock-demo-pinned.mjs <<'JS'
globalThis.beforeEach = () => {};
globalThis.afterAll = () => {};

const root = process.cwd();
const { todayIn } = await import(root + '/frontend/lib/habits/dates.ts');
const { pinClock } = await import(root + '/frontend/lib/pin-clock.ts');

const SIMULATED_RUNS = ['2020-01-01T00:00:00.000Z', '2026-07-28T09:00:00.000Z', '2030-12-31T23:00:00.000Z'];

for (const runAt of SIMULATED_RUNS) {
  pinClock(runAt);                          // whatever moment the suite happens to run at...
  pinClock('2026-07-28T12:00:00.000Z');     // ...the test file's own pin wins regardless
  const today = todayIn('UTC');
  console.log(`suite runs at ${runAt} -> pinned today  = ${today}, "2026-08-01" reads as future: ${'2026-08-01' > today}`);
}
JS
node /tmp/clock-demo-pinned.mjs 2>/dev/null
```

```output
suite runs at 2020-01-01T00:00:00.000Z -> pinned today  = 2026-07-28, "2026-08-01" reads as future: true
suite runs at 2026-07-28T09:00:00.000Z -> pinned today  = 2026-07-28, "2026-08-01" reads as future: true
suite runs at 2030-12-31T23:00:00.000Z -> pinned today  = 2026-07-28, "2026-08-01" reads as future: true
```

Same answer on all three simulated runs — the pinned instant wins over whatever the ambient clock
says, so `'2026-08-01'` stays "the future" forever, not just today.

The second bug — a day-of-week check against a hardcoded `active_days: [1]` (Mondays-only)
fixture — needs the same treatment, plus one thing more: a genuine positive case. The old test
only ever asserted "today is not a Monday," true by accident six days out of seven; it never
proved the check flips true on the day the habit runs. `setClockNow` (also from
`pin-clock.ts`) shifts the pinned clock for just this check, the same way the added test shifts it
for just one `it`:

```bash
cat > /tmp/clock-demo-weekday.mjs <<'JS'
globalThis.beforeEach = () => {};
globalThis.afterAll = () => {};

const root = process.cwd();
const { todayIn, isoWeekday } = await import(root + '/frontend/lib/habits/dates.ts');
const { pinClock, setClockNow } = await import(root + '/frontend/lib/pin-clock.ts');
const WEEKDAY_NAME = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The exact pin habits-store.test.tsx uses for every test in the file.
pinClock('2026-07-28T12:00:00.000Z');
const today = todayIn('UTC');
console.log(`pinned "today" = ${today} (${WEEKDAY_NAME[isoWeekday(today)]}) -> active_days: [1] (Mon) is NOT applicable`);

// setClockNow shifts just this check -- the same call the added positive test makes.
setClockNow('2026-08-03T12:00:00.000Z');
const monday = todayIn('UTC');
console.log(`setClockNow to  = ${monday} (${WEEKDAY_NAME[isoWeekday(monday)]}) -> the SAME habit IS applicable now`);
JS
node /tmp/clock-demo-weekday.mjs 2>/dev/null
```

```output
pinned "today" = 2026-07-28 (Tue) -> active_days: [1] (Mon) is NOT applicable
setClockNow to  = 2026-08-03 (Mon) -> the SAME habit IS applicable now
```

`habits-store.test.tsx` now calls `pinClock('2026-07-28T20:00:00.000Z')` once, right after its
imports, and the two fragile tests above needed no other change: `started_on: '2026-08-01'` is
safe forever now that "today" can never drift past it, and the Mondays-only check gained the
positive sibling test this doc's last block reproduces.

The same `pinClock` call was applied to every other frontend test that read `new Date()`,
`Date.now()`, or `todayIn(...)` with no injected `now`: the habits API routes and data reader
(`app/api/habits/route.test.ts`, `app/api/habits/[id]/entries/route.test.ts`,
`lib/data/habits.test.ts`), and the due-date/calendar surfaces (`lib/date-utils.test.ts`,
`lib/tree.test.ts`, `lib/stores/tasks-store.test.tsx`, `components/atoms/calendar.test.tsx`,
`components/tasks/due-date-chip.test.tsx`, `components/tasks/folder-nav.test.tsx`,
`components/tasks/task-row.test.tsx`) — eleven files in total, all now deterministic regardless
of when the suite runs.

One thing `pinClock` deliberately does NOT touch: `Intl.DateTimeFormat`. The
`describe('today')` block in `habits-store.test.tsx` spies on
`Intl.DateTimeFormat.prototype.resolvedOptions` to force a specific browser timezone, and that
test still needs to observe genuine timezone resolution — `jest.useFakeTimers()` would have faked
`Intl.DateTimeFormat` too and silently broken that spy (see the `jest` skill's updated pitfall).
`pinClock` fakes `Date` alone via a `Proxy`, so that test is unaffected and still fails if the
timezone-correction effect it exercises is broken (confirmed by hand while building this fix,
not shown here since that would mean shipping broken code to demonstrate it).
