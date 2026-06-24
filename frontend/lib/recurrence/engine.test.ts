import { nextOccurrence, summarizeRule } from './engine';
import type { RecurrenceEnd, RecurrenceRule } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEVER: RecurrenceEnd = { type: 'never' };

/** Build a rule with `end: never` unless overridden. */
function rule(partial: Omit<RecurrenceRule, 'end'> & { end?: RecurrenceEnd }): RecurrenceRule {
  const { end, ...rest } = partial;
  return { ...rest, end: end ?? NEVER };
}

/** A monthly day-of-month rule at the given interval. */
function dayOfMonthRule(interval: number): RecurrenceRule {
  return rule({ freq: 'monthly', interval, monthly: { kind: 'day_of_month' } });
}

/** A monthly positional rule (interval 1) at the given setpos + weekday. */
function positionalRule(
  setpos: 1 | 2 | 3 | 4 | 5 | -1,
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): RecurrenceRule {
  return rule({ freq: 'monthly', interval: 1, monthly: { kind: 'positional', setpos, weekday } });
}

/** A daily rule that stops on the given inclusive ISO date. */
function dailyUntil(date: string): RecurrenceRule {
  return rule({ freq: 'daily', interval: 1, end: { type: 'on_date', until: date } });
}

/** A daily rule that stops after the given total occurrence count. */
function dailyAfter(count: number): RecurrenceRule {
  return rule({ freq: 'daily', interval: 1, end: { type: 'after', count } });
}

describe('nextOccurrence', () => {
  // ── Hourly (engine-only) ─────────────────────────────────────────────────
  describe('hourly', () => {
    it('adds one hour, carrying a time component', () => {
      expect(nextOccurrence(rule({ freq: 'hourly', interval: 1 }), '2026-06-01T09:00:00', 1)).toBe(
        '2026-06-01T10:00:00',
      );
    });

    it('advances by interval hours and rolls over to the next day', () => {
      expect(nextOccurrence(rule({ freq: 'hourly', interval: 5 }), '2026-06-01T22:00:00', 1)).toBe(
        '2026-06-02T03:00:00',
      );
    });

    it('treats a bare date as local midnight', () => {
      expect(nextOccurrence(rule({ freq: 'hourly', interval: 2 }), '2026-06-01', 1)).toBe(
        '2026-06-01T02:00:00',
      );
    });
  });

  // ── Daily ─────────────────────────────────────────────────────────────────
  describe('daily', () => {
    it('adds one day', () => {
      expect(nextOccurrence(rule({ freq: 'daily', interval: 1 }), '2026-06-01', 1)).toBe(
        '2026-06-02',
      );
    });

    it('advances by interval days', () => {
      expect(nextOccurrence(rule({ freq: 'daily', interval: 10 }), '2026-06-25', 1)).toBe(
        '2026-07-05',
      );
    });

    it('crosses a month boundary', () => {
      expect(nextOccurrence(rule({ freq: 'daily', interval: 1 }), '2026-01-31', 1)).toBe(
        '2026-02-01',
      );
    });
  });

  // ── Weekly ──────────────────────────────────────────────────────────────
  describe('weekly', () => {
    // 2026-06-01 is a Monday.
    it('advances to the next selected weekday within the same week', () => {
      // Mon (1) + Wed (3): from Monday → Wednesday.
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 1, byweekday: [1, 3] }), '2026-06-01', 1),
      ).toBe('2026-06-03');
    });

    it('rolls over to the next week when the current week is exhausted', () => {
      // Mon (1) + Wed (3): from Wednesday → next Monday.
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 1, byweekday: [1, 3] }), '2026-06-03', 1),
      ).toBe('2026-06-08');
    });

    it('jumps interval weeks forward on roll-over (biweekly)', () => {
      // Single Monday, every 2 weeks: Mon 2026-06-01 → Mon 2026-06-15.
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 2, byweekday: [1] }), '2026-06-01', 1),
      ).toBe('2026-06-15');
    });

    it('handles weekdays (Mon–Fri) rolling Friday → Monday', () => {
      // 2026-06-05 is a Friday.
      expect(
        nextOccurrence(
          rule({ freq: 'weekly', interval: 1, byweekday: [1, 2, 3, 4, 5] }),
          '2026-06-05',
          1,
        ),
      ).toBe('2026-06-08');
    });

    it('handles weekends (Sun + Sat) Saturday → Sunday', () => {
      // 2026-06-06 is a Saturday → next selected is Sunday 2026-06-07.
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 1, byweekday: [0, 6] }), '2026-06-06', 1),
      ).toBe('2026-06-07');
    });

    it('handles weekends Sunday → next Saturday', () => {
      // 2026-06-07 is a Sunday → next selected is Saturday 2026-06-13.
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 1, byweekday: [0, 6] }), '2026-06-07', 1),
      ).toBe('2026-06-13');
    });

    it('is order-independent in byweekday', () => {
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 1, byweekday: [3, 1] }), '2026-06-01', 1),
      ).toBe('2026-06-03');
    });
  });

  // ── Monthly: day_of_month ─────────────────────────────────────────────────
  describe('monthly day_of_month', () => {
    it('keeps the same day-of-month one month later', () => {
      expect(nextOccurrence(dayOfMonthRule(1), '2026-06-15', 1)).toBe('2026-07-15');
    });

    it('advances by interval months', () => {
      expect(nextOccurrence(dayOfMonthRule(3), '2026-01-15', 1)).toBe('2026-04-15');
      expect(nextOccurrence(dayOfMonthRule(6), '2026-01-15', 1)).toBe('2026-07-15');
    });

    it('crosses a year boundary', () => {
      expect(nextOccurrence(dayOfMonthRule(1), '2026-12-10', 1)).toBe('2027-01-10');
    });

    it('clamps Jan 31 + 1 month to Feb 28 in a non-leap year', () => {
      expect(nextOccurrence(dayOfMonthRule(1), '2026-01-31', 1)).toBe('2026-02-28');
    });

    it('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
      expect(nextOccurrence(dayOfMonthRule(1), '2028-01-31', 1)).toBe('2028-02-29');
    });

    it('clamps Aug 31 + 1 month to Sep 30', () => {
      expect(nextOccurrence(dayOfMonthRule(1), '2026-08-31', 1)).toBe('2026-09-30');
    });
  });

  // ── Monthly: positional ───────────────────────────────────────────────────
  describe('monthly positional', () => {
    it('finds the first Monday of the next month', () => {
      // First Monday of July 2026 is 2026-07-06.
      expect(nextOccurrence(positionalRule(1, 1), '2026-06-01', 1)).toBe('2026-07-06');
    });

    it('finds the third Tuesday of the next month', () => {
      // Third Tuesday of July 2026 is 2026-07-21.
      expect(nextOccurrence(positionalRule(3, 2), '2026-06-16', 1)).toBe('2026-07-21');
    });

    it('finds the last Friday of the next month', () => {
      // Last Friday of July 2026 is 2026-07-31.
      expect(nextOccurrence(positionalRule(-1, 5), '2026-06-26', 1)).toBe('2026-07-31');
    });

    it('skips to the next eligible month when the 5th weekday is absent', () => {
      // 5th Sunday, +1 month from a June 2026 anchor: July 2026 has only four Sundays
      // (5,12,19,26), so the engine must skip July and land on the next month that has a
      // 5th Sunday → Aug 30 2026 (Sundays 2,9,16,23,30).
      expect(nextOccurrence(positionalRule(5, 0), '2026-06-30', 1)).toBe('2026-08-30');
    });

    it('respects interval when skipping (every 2 months, 5th Sunday)', () => {
      // From 2026-06-30, every 2 months: candidate months are Aug, Oct, Dec, ...
      // Aug 2026 has a 5th Sunday (30th); so it lands there directly.
      expect(
        nextOccurrence(
          rule({
            freq: 'monthly',
            interval: 2,
            monthly: { kind: 'positional', setpos: 5, weekday: 0 },
          }),
          '2026-06-30',
          1,
        ),
      ).toBe('2026-08-30');
    });
  });

  // ── Yearly ────────────────────────────────────────────────────────────────
  describe('yearly', () => {
    it('keeps the same month + day one year later', () => {
      expect(nextOccurrence(rule({ freq: 'yearly', interval: 1 }), '2026-03-15', 1)).toBe(
        '2027-03-15',
      );
    });

    it('advances by interval years', () => {
      expect(nextOccurrence(rule({ freq: 'yearly', interval: 2 }), '2026-03-15', 1)).toBe(
        '2028-03-15',
      );
    });

    it('clamps Feb 29 → Feb 28 in a non-leap year', () => {
      // 2028 is a leap year; +1 year → 2029 (non-leap) clamps to Feb 28.
      expect(nextOccurrence(rule({ freq: 'yearly', interval: 1 }), '2028-02-29', 1)).toBe(
        '2029-02-28',
      );
    });

    it('keeps Feb 29 when landing on another leap year', () => {
      // 2028 → +4 years → 2032 (also leap).
      expect(nextOccurrence(rule({ freq: 'yearly', interval: 4 }), '2028-02-29', 1)).toBe(
        '2032-02-29',
      );
    });
  });

  // ── End conditions ──────────────────────────────────────────────────────
  describe('end conditions', () => {
    it('never always advances', () => {
      expect(
        nextOccurrence(rule({ freq: 'daily', interval: 1, end: NEVER }), '2026-06-01', 999),
      ).toBe('2026-06-02');
    });

    describe('on_date', () => {
      it('returns the next date when it is before until', () => {
        expect(nextOccurrence(dailyUntil('2026-06-10'), '2026-06-01', 1)).toBe('2026-06-02');
      });

      it('is boundary-inclusive: returns the date when it equals until', () => {
        expect(nextOccurrence(dailyUntil('2026-06-02'), '2026-06-01', 1)).toBe('2026-06-02');
      });

      it('returns null when the next date is strictly after until', () => {
        expect(nextOccurrence(dailyUntil('2026-06-01'), '2026-06-01', 1)).toBeNull();
      });
    });

    describe('after N', () => {
      it('advances while the current index is below the count', () => {
        expect(nextOccurrence(dailyAfter(3), '2026-06-01', 1)).toBe('2026-06-02');
        expect(nextOccurrence(dailyAfter(3), '2026-06-02', 2)).toBe('2026-06-03');
      });

      it('returns null once the index reaches the count (the Nth is the last)', () => {
        expect(nextOccurrence(dailyAfter(3), '2026-06-03', 3)).toBeNull();
      });

      it('returns null when the index exceeds the count', () => {
        expect(nextOccurrence(dailyAfter(3), '2026-06-04', 4)).toBeNull();
      });
    });
  });

  // ── DST: no drift across spring-forward / fall-back ──────────────────────
  describe('DST boundaries (local-calendar convention, no drift)', () => {
    it('daily steps land on consecutive calendar dates across US spring-forward', () => {
      // 2026-03-08 is the US spring-forward date.
      expect(nextOccurrence(rule({ freq: 'daily', interval: 1 }), '2026-03-07', 1)).toBe(
        '2026-03-08',
      );
      expect(nextOccurrence(rule({ freq: 'daily', interval: 1 }), '2026-03-08', 2)).toBe(
        '2026-03-09',
      );
    });

    it('daily steps land on consecutive calendar dates across US fall-back', () => {
      // 2026-11-01 is the US fall-back date.
      expect(nextOccurrence(rule({ freq: 'daily', interval: 1 }), '2026-10-31', 1)).toBe(
        '2026-11-01',
      );
      expect(nextOccurrence(rule({ freq: 'daily', interval: 1 }), '2026-11-01', 2)).toBe(
        '2026-11-02',
      );
    });

    it('a weekly step spanning spring-forward keeps the weekday', () => {
      // 2026-03-02 is a Monday; +1 week spans the DST change but stays Monday 2026-03-09.
      expect(
        nextOccurrence(rule({ freq: 'weekly', interval: 1, byweekday: [1] }), '2026-03-02', 1),
      ).toBe('2026-03-09');
    });
  });
});

describe('summarizeRule', () => {
  it('summarizes simple frequencies (interval 1)', () => {
    expect(summarizeRule(rule({ freq: 'hourly', interval: 1 }))).toBe('Hourly');
    expect(summarizeRule(rule({ freq: 'daily', interval: 1 }))).toBe('Daily');
    expect(summarizeRule(rule({ freq: 'yearly', interval: 1 }))).toBe('Yearly');
    expect(
      summarizeRule(rule({ freq: 'monthly', interval: 1, monthly: { kind: 'day_of_month' } })),
    ).toBe('Monthly');
  });

  it('pluralizes intervals > 1', () => {
    expect(summarizeRule(rule({ freq: 'hourly', interval: 3 }))).toBe('Every 3 hours');
    expect(summarizeRule(rule({ freq: 'daily', interval: 2 }))).toBe('Every 2 days');
    expect(
      summarizeRule(rule({ freq: 'monthly', interval: 3, monthly: { kind: 'day_of_month' } })),
    ).toBe('Every 3 months');
    expect(summarizeRule(rule({ freq: 'yearly', interval: 5 }))).toBe('Every 5 years');
  });

  it('names weekdays and weekends specially', () => {
    expect(summarizeRule(rule({ freq: 'weekly', interval: 1, byweekday: [1, 2, 3, 4, 5] }))).toBe(
      'Weekdays',
    );
    expect(summarizeRule(rule({ freq: 'weekly', interval: 1, byweekday: [0, 6] }))).toBe(
      'Weekends',
    );
  });

  it('lists weekly days', () => {
    expect(summarizeRule(rule({ freq: 'weekly', interval: 1, byweekday: [1] }))).toBe(
      'Weekly on Mon',
    );
    expect(summarizeRule(rule({ freq: 'weekly', interval: 2, byweekday: [1, 3] }))).toBe(
      'Every 2 weeks on Mon, Wed',
    );
  });

  it('summarizes positional monthly rules', () => {
    expect(
      summarizeRule(
        rule({
          freq: 'monthly',
          interval: 1,
          monthly: { kind: 'positional', setpos: -1, weekday: 5 },
        }),
      ),
    ).toBe('Monthly on the last Fri');
    expect(
      summarizeRule(
        rule({
          freq: 'monthly',
          interval: 1,
          monthly: { kind: 'positional', setpos: 1, weekday: 1 },
        }),
      ),
    ).toBe('Monthly on the first Mon');
  });

  it('appends an until suffix for on_date', () => {
    expect(
      summarizeRule(
        rule({ freq: 'daily', interval: 1, end: { type: 'on_date', until: '2026-08-01' } }),
      ),
    ).toBe('Daily until Aug 1');
  });

  it('appends a count suffix for after', () => {
    expect(
      summarizeRule(
        rule({ freq: 'weekly', interval: 1, byweekday: [1], end: { type: 'after', count: 5 } }),
      ),
    ).toBe('Weekly on Mon for 5 times');
  });
});
