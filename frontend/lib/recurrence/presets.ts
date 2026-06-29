/**
 * The bridge between the friendly preset menu (screenshot 1) and the persisted
 * {@link RecurrenceRule}. The menu is just a front-end for common rules, so `ruleFromPreset`
 * and `presetForRule` round-trip: a preset → its rule → back to the same preset. A rule that
 * no preset matches maps to `'custom'`, so the menu can show the Custom checkmark.
 */
import { parseDueDate } from '@/lib/date-utils';

import { sortedWeekdays } from './engine';
import type { RecurrencePreset, RecurrenceRule, Weekday } from './types';

/**
 * The selectable presets shown in the Repeat picker, in menu order. Hourly is deferred (it
 * needs a time anchor) and `custom` is appended by the UI, so this lists only the canonical
 * `'never'` … `'yearly'` presets. Single-sourced here so the meta-panel field and the detail
 * chip's popover never drift on the option set or its labels.
 */
export const REPEAT_PRESETS: readonly {
  value: Exclude<RecurrencePreset, 'custom' | 'hourly'>;
  label: string;
}[] = [
  { value: 'never', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'every-3-months', label: 'Every 3 Months' },
  { value: 'every-6-months', label: 'Every 6 Months' },
  { value: 'yearly', label: 'Yearly' },
];

/** The weekday of an anchor due date (0 = Sunday … 6 = Saturday). */
function anchorWeekday(anchorDate: string): Weekday {
  return parseDueDate(anchorDate).getDay() as Weekday;
}

/**
 * Build the rule for a preset, anchored to a due date (Weekly/Biweekly take the anchor's
 * weekday). `'never'` and `'custom'` have no canonical rule, so they return `null` — the
 * caller clears recurrence for `'never'` and opens the editor for `'custom'`.
 */
export function ruleFromPreset(
  preset: RecurrencePreset,
  anchorDate: string,
): RecurrenceRule | null {
  const end = { type: 'never' } as const;
  switch (preset) {
    case 'never':
    case 'custom': {
      return null;
    }
    case 'hourly': {
      return { freq: 'hourly', interval: 1, end };
    }
    case 'daily': {
      return { freq: 'daily', interval: 1, end };
    }
    case 'weekdays': {
      return { freq: 'weekly', interval: 1, byweekday: [1, 2, 3, 4, 5], end };
    }
    case 'weekends': {
      return { freq: 'weekly', interval: 1, byweekday: [0, 6], end };
    }
    case 'weekly': {
      return { freq: 'weekly', interval: 1, byweekday: [anchorWeekday(anchorDate)], end };
    }
    case 'biweekly': {
      return { freq: 'weekly', interval: 2, byweekday: [anchorWeekday(anchorDate)], end };
    }
    case 'monthly': {
      return { freq: 'monthly', interval: 1, monthly: { kind: 'day_of_month' }, end };
    }
    case 'every-3-months': {
      return { freq: 'monthly', interval: 3, monthly: { kind: 'day_of_month' }, end };
    }
    case 'every-6-months': {
      return { freq: 'monthly', interval: 6, monthly: { kind: 'day_of_month' }, end };
    }
    case 'yearly': {
      return { freq: 'yearly', interval: 1, end };
    }
  }
}

/** Order-independent set equality over weekdays. */
function sameDays(byweekday: Weekday[] | undefined, target: Weekday[]): boolean {
  const days = sortedWeekdays(byweekday ?? []);
  return days.length === target.length && days.every((d, index) => d === target[index]);
}

/**
 * The preset a rule corresponds to, or `'custom'` when none matches. Only rules with
 * `end.type === 'never'` can be presets (every preset ends never); a rule with an end
 * condition, an odd interval, or a positional monthly mode is always `'custom'`.
 */
export function presetForRule(rule: RecurrenceRule): RecurrencePreset {
  if (rule.end.type !== 'never') return 'custom';
  switch (rule.freq) {
    case 'hourly': {
      return rule.interval === 1 ? 'hourly' : 'custom';
    }
    case 'daily': {
      return rule.interval === 1 ? 'daily' : 'custom';
    }
    case 'weekly': {
      if (rule.interval === 1 && sameDays(rule.byweekday, [1, 2, 3, 4, 5])) return 'weekdays';
      if (rule.interval === 1 && sameDays(rule.byweekday, [0, 6])) return 'weekends';
      const dayCount = new Set(rule.byweekday).size;
      if (dayCount === 1) {
        if (rule.interval === 1) return 'weekly';
        if (rule.interval === 2) return 'biweekly';
      }
      return 'custom';
    }
    case 'monthly': {
      const monthly = rule.monthly ?? { kind: 'day_of_month' };
      if (monthly.kind !== 'day_of_month') return 'custom';
      if (rule.interval === 1) return 'monthly';
      if (rule.interval === 3) return 'every-3-months';
      if (rule.interval === 6) return 'every-6-months';
      return 'custom';
    }
    case 'yearly': {
      return rule.interval === 1 ? 'yearly' : 'custom';
    }
  }
}
