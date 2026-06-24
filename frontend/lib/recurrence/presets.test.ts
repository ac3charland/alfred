import { presetForRule, ruleFromPreset } from './presets';
import type { RecurrencePreset, RecurrenceRule } from './types';

// 2026-06-01 is a Monday (weekday 1); 2026-06-03 is a Wednesday (weekday 3).
const MONDAY = '2026-06-01';
const WEDNESDAY = '2026-06-03';

/** A monthly day-of-month rule (end never) at the given interval. */
function monthlyRule(interval: number): RecurrenceRule {
  return { freq: 'monthly', interval, monthly: { kind: 'day_of_month' }, end: { type: 'never' } };
}

describe('ruleFromPreset', () => {
  it('returns null for never and custom (no canonical rule)', () => {
    expect(ruleFromPreset('never', MONDAY)).toBeNull();
    expect(ruleFromPreset('custom', MONDAY)).toBeNull();
  });

  it('builds the fixed-frequency presets', () => {
    expect(ruleFromPreset('hourly', MONDAY)).toStrictEqual({
      freq: 'hourly',
      interval: 1,
      end: { type: 'never' },
    });
    expect(ruleFromPreset('daily', MONDAY)).toStrictEqual({
      freq: 'daily',
      interval: 1,
      end: { type: 'never' },
    });
    expect(ruleFromPreset('yearly', MONDAY)).toStrictEqual({
      freq: 'yearly',
      interval: 1,
      end: { type: 'never' },
    });
  });

  it('builds the weekly presets with fixed day sets', () => {
    expect(ruleFromPreset('weekdays', MONDAY)).toStrictEqual({
      freq: 'weekly',
      interval: 1,
      byweekday: [1, 2, 3, 4, 5],
      end: { type: 'never' },
    });
    expect(ruleFromPreset('weekends', MONDAY)).toStrictEqual({
      freq: 'weekly',
      interval: 1,
      byweekday: [0, 6],
      end: { type: 'never' },
    });
  });

  it('anchors weekly/biweekly to the due date weekday', () => {
    expect(ruleFromPreset('weekly', WEDNESDAY)?.byweekday).toStrictEqual([3]);
    expect(ruleFromPreset('biweekly', WEDNESDAY)).toStrictEqual({
      freq: 'weekly',
      interval: 2,
      byweekday: [3],
      end: { type: 'never' },
    });
  });

  it('builds the monthly presets with the right interval', () => {
    expect(ruleFromPreset('monthly', MONDAY)?.interval).toBe(1);
    expect(ruleFromPreset('every-3-months', MONDAY)?.interval).toBe(3);
    expect(ruleFromPreset('every-6-months', MONDAY)?.interval).toBe(6);
    expect(ruleFromPreset('monthly', MONDAY)?.monthly).toStrictEqual({ kind: 'day_of_month' });
  });
});

describe('presetForRule', () => {
  it('identifies every fixed preset', () => {
    expect(presetForRule({ freq: 'hourly', interval: 1, end: { type: 'never' } })).toBe('hourly');
    expect(presetForRule({ freq: 'daily', interval: 1, end: { type: 'never' } })).toBe('daily');
    expect(presetForRule({ freq: 'yearly', interval: 1, end: { type: 'never' } })).toBe('yearly');
  });

  it('identifies weekdays and weekends regardless of day order', () => {
    expect(
      presetForRule({
        freq: 'weekly',
        interval: 1,
        byweekday: [5, 1, 3, 2, 4],
        end: { type: 'never' },
      }),
    ).toBe('weekdays');
    expect(
      presetForRule({ freq: 'weekly', interval: 1, byweekday: [6, 0], end: { type: 'never' } }),
    ).toBe('weekends');
  });

  it('identifies weekly and biweekly single-day rules', () => {
    expect(
      presetForRule({ freq: 'weekly', interval: 1, byweekday: [3], end: { type: 'never' } }),
    ).toBe('weekly');
    expect(
      presetForRule({ freq: 'weekly', interval: 2, byweekday: [3], end: { type: 'never' } }),
    ).toBe('biweekly');
  });

  it('identifies the monthly intervals', () => {
    expect(presetForRule(monthlyRule(1))).toBe('monthly');
    expect(presetForRule(monthlyRule(3))).toBe('every-3-months');
    expect(presetForRule(monthlyRule(6))).toBe('every-6-months');
  });

  it('falls back to custom for rules no preset matches', () => {
    // End condition present.
    expect(presetForRule({ freq: 'daily', interval: 1, end: { type: 'after', count: 5 } })).toBe(
      'custom',
    );
    // Odd interval.
    expect(presetForRule({ freq: 'daily', interval: 2, end: { type: 'never' } })).toBe('custom');
    expect(presetForRule({ freq: 'yearly', interval: 2, end: { type: 'never' } })).toBe('custom');
    // Multi-day weekly that isn't weekdays/weekends.
    expect(
      presetForRule({ freq: 'weekly', interval: 1, byweekday: [1, 3], end: { type: 'never' } }),
    ).toBe('custom');
    // Unusual monthly interval and positional monthly.
    expect(
      presetForRule({
        freq: 'monthly',
        interval: 2,
        monthly: { kind: 'day_of_month' },
        end: { type: 'never' },
      }),
    ).toBe('custom');
    expect(
      presetForRule({
        freq: 'monthly',
        interval: 1,
        monthly: { kind: 'positional', setpos: -1, weekday: 5 },
        end: { type: 'never' },
      }),
    ).toBe('custom');
  });
});

describe('preset round-trip', () => {
  const presets: RecurrencePreset[] = [
    'hourly',
    'daily',
    'weekdays',
    'weekends',
    'weekly',
    'biweekly',
    'monthly',
    'every-3-months',
    'every-6-months',
    'yearly',
  ];

  it('every preset maps to a rule that maps back to the same preset', () => {
    for (const preset of presets) {
      const built = ruleFromPreset(preset, MONDAY);
      expect(built).not.toBeNull();
      if (built !== null) expect(presetForRule(built)).toBe(preset);
    }
  });
});
