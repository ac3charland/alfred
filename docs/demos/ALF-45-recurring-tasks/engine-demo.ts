// A runnable demonstration of the pure recurrence engine — the real next-occurrence math and
// human summaries, no test harness. Bundled with esbuild (which resolves the `@/` alias from
// frontend/tsconfig.json) and run with node, so the captured output below is the engine's own.
import { nextOccurrence, summarizeRule } from '@/lib/recurrence';
import { ruleFromPreset } from '@/lib/recurrence';
import type { RecurrenceRule } from '@/lib/recurrence';

function show(label: string, rule: RecurrenceRule, due: string, index: number): void {
  const next = nextOccurrence(rule, due, index);
  process.stdout.write(
    `${label}\n  summary:  ${summarizeRule(rule)}\n  from ${due} (#${index}) → next: ${String(next)}\n\n`,
  );
}

// 1. Custom Weekly on Monday, anchored to Mon 2026-06-01 → completing #1 spawns Mon 2026-06-08.
const weekly = ruleFromPreset('weekly', '2026-06-01')!;
show('Weekly on Monday', weekly, '2026-06-01', 1);

// 2. Multi-day weekly (Mon + Wed), every 2 weeks — same-week hop, then the interval jump.
const biweekly: RecurrenceRule = { freq: 'weekly', interval: 2, byweekday: [1, 3], end: { type: 'never' } };
show('Every 2 weeks on Mon, Wed (Mon → Wed)', biweekly, '2026-06-01', 1);
show('Every 2 weeks on Mon, Wed (Wed → +2wk Mon)', biweekly, '2026-06-03', 2);

// 3. Monthly day-of-month clamps Jan 31 → Feb 28 (non-leap).
const monthly: RecurrenceRule = { freq: 'monthly', interval: 1, monthly: { kind: 'day_of_month' }, end: { type: 'never' } };
show('Monthly on the 31st (clamps to Feb 28)', monthly, '2026-01-31', 1);

// 4. Monthly positional: the last Friday, every month.
const lastFri: RecurrenceRule = { freq: 'monthly', interval: 1, monthly: { kind: 'positional', setpos: -1, weekday: 5 }, end: { type: 'never' } };
show('Monthly on the last Friday', lastFri, '2026-06-26', 1);

// 5. Yearly clamps Feb 29 → Feb 28 in a non-leap year.
const yearly: RecurrenceRule = { freq: 'yearly', interval: 1, end: { type: 'never' } };
show('Yearly on Feb 29 (clamps to Feb 28)', yearly, '2028-02-29', 1);

// 6. End condition: "after 2" — the 2nd occurrence is the last, so completing it spawns nothing.
const ends: RecurrenceRule = { freq: 'daily', interval: 1, end: { type: 'after', count: 2 } };
show('Daily, ends after 2 (from #1)', ends, '2026-06-01', 1);
show('Daily, ends after 2 (from #2 — no successor)', ends, '2026-06-02', 2);
