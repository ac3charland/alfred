/**
 * The shared recurrence-rule shape — modeled on the iCal RRULE subset Apple Reminders
 * exposes. Defined once here (the pure-engine source of truth) and mirrored by a Zod schema
 * at the API boundary (`lib/api/schemas`). Persisted as a single JSONB column on `items`, so
 * the preset menu and the Custom editor are two views of the same value.
 */

/** A recurrence frequency. `hourly` is engine-only for now (no UI entry — needs a time anchor). */
export type RecurrenceFreq = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Day of week, 0 = Sunday … 6 = Saturday (matches `Date.prototype.getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which day of the target month a monthly rule lands on. */
export type MonthlyMode =
  // The same day-of-month as the anchor (e.g. the 15th), clamped to the month's last day.
  | { kind: 'day_of_month' }
  // The Nth weekday: setpos 1..5, or -1 for the last; e.g. "first Monday" … "last Friday".
  | { kind: 'positional'; setpos: 1 | 2 | 3 | 4 | 5 | -1; weekday: Weekday };

/** When the series stops. */
export type RecurrenceEnd =
  | { type: 'never' }
  // Inclusive ISO date — stop once the next due date is strictly after `until`.
  | { type: 'on_date'; until: string }
  // Total occurrences across the series (>= 1); the count-th occurrence is the last.
  | { type: 'after'; count: number };

/**
 * A complete recurrence rule. The optional fields spell out `| undefined` so the type accepts
 * the Zod schema's parsed output verbatim under `exactOptionalPropertyTypes` (zod types an
 * `.optional()` field as `T | undefined`); the engine treats absent and `undefined` alike.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** "Every N" — >= 1. */
  interval: number;
  /** Weekly only; non-empty when present. */
  byweekday?: Weekday[] | undefined;
  /** Monthly only. */
  monthly?: MonthlyMode | undefined;
  end: RecurrenceEnd;
}

/** The preset-menu options (screenshot 1). `custom` marks a rule no preset matches. */
export type RecurrencePreset =
  | 'never'
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'every-3-months'
  | 'every-6-months'
  | 'yearly'
  | 'custom';
