'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import { parseDueDate } from '@/lib/date-utils';
import { sortedWeekdays } from '@/lib/recurrence';
import type { MonthlyMode, RecurrenceEnd, RecurrenceRule, Weekday } from '@/lib/recurrence';
import { cn } from '@/lib/utils';

/** The frequencies the Custom editor offers (Hourly is engine-only — it needs a time anchor). */
type EditorFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

const FREQ_OPTIONS: { value: EditorFreq; label: string; unit: string }[] = [
  { value: 'daily', label: 'Daily', unit: 'day' },
  { value: 'weekly', label: 'Weekly', unit: 'week' },
  { value: 'monthly', label: 'Monthly', unit: 'month' },
  { value: 'yearly', label: 'Yearly', unit: 'year' },
];

const WEEKDAY_TOGGLES: { value: Weekday; short: string; name: string }[] = [
  { value: 0, short: 'S', name: 'Sunday' },
  { value: 1, short: 'M', name: 'Monday' },
  { value: 2, short: 'T', name: 'Tuesday' },
  { value: 3, short: 'W', name: 'Wednesday' },
  { value: 4, short: 'T', name: 'Thursday' },
  { value: 5, short: 'F', name: 'Friday' },
  { value: 6, short: 'S', name: 'Saturday' },
];

const SETPOS_OPTIONS: { value: 1 | 2 | 3 | 4 | 5 | -1; label: string }[] = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: 5, label: 'fifth' },
  { value: -1, label: 'last' },
];

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface EditorState {
  freq: EditorFreq;
  interval: number;
  byweekday: Weekday[];
  monthlyKind: 'day_of_month' | 'positional';
  setpos: 1 | 2 | 3 | 4 | 5 | -1;
  posWeekday: Weekday;
  endType: RecurrenceEnd['type'];
  until: string;
  count: number;
}

/** Seed the editor from an existing rule (pre-fill when opened from a preset) + the anchor date. */
function deriveInitialState(rule: RecurrenceRule | null, anchorDate: string): EditorState {
  const anchor = parseDueDate(anchorDate);
  const anchorWeekday = anchor.getDay() as Weekday;
  // Which occurrence of its weekday the anchor is within its month (1..5), the positional default.
  const anchorSetpos = Math.min(Math.ceil(anchor.getDate() / 7), 5) as 1 | 2 | 3 | 4 | 5;

  const base: EditorState = {
    freq: 'daily',
    interval: 1,
    byweekday: [anchorWeekday],
    monthlyKind: 'day_of_month',
    setpos: anchorSetpos,
    posWeekday: anchorWeekday,
    endType: 'never',
    until: anchorDate,
    count: 10,
  };
  if (rule === null) return base;

  return {
    ...base,
    // Hourly has no Custom UI; fall back to daily so the editor stays in range.
    freq: rule.freq === 'hourly' ? 'daily' : rule.freq,
    interval: rule.interval,
    byweekday:
      rule.byweekday !== undefined && rule.byweekday.length > 0 ? rule.byweekday : base.byweekday,
    monthlyKind: rule.monthly?.kind ?? base.monthlyKind,
    setpos: rule.monthly?.kind === 'positional' ? rule.monthly.setpos : base.setpos,
    posWeekday: rule.monthly?.kind === 'positional' ? rule.monthly.weekday : base.posWeekday,
    endType: rule.end.type,
    until: rule.end.type === 'on_date' ? rule.end.until : base.until,
    count: rule.end.type === 'after' ? rule.end.count : base.count,
  };
}

/** Assemble the persisted rule from the editor's flat state. */
function buildRule(state: EditorState): RecurrenceRule {
  const end: RecurrenceEnd =
    state.endType === 'on_date'
      ? { type: 'on_date', until: state.until }
      : state.endType === 'after'
        ? { type: 'after', count: state.count }
        : { type: 'never' };

  if (state.freq === 'weekly') {
    return {
      freq: 'weekly',
      interval: state.interval,
      byweekday: sortedWeekdays(state.byweekday),
      end,
    };
  }
  if (state.freq === 'monthly') {
    const monthly: MonthlyMode =
      state.monthlyKind === 'positional'
        ? { kind: 'positional', setpos: state.setpos, weekday: state.posWeekday }
        : { kind: 'day_of_month' };
    return { freq: 'monthly', interval: state.interval, monthly, end };
  }
  return { freq: state.freq, interval: state.interval, end };
}

const selectClass = cn(
  'rounded-sm border border-border bg-input px-2 py-1 text-sm text-foreground',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
);

interface RecurrenceEditorProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rule to pre-fill from (e.g. the equivalent of the chosen preset), or null for defaults. */
  initialRule: RecurrenceRule | null;
  /** The task's anchor due date — seeds weekly day / yearly month-day / positional defaults. */
  anchorDate: string;
  /** Commit the assembled rule (OK). */
  onSave: (rule: RecurrenceRule) => void;
}

/**
 * The full Apple-style custom recurrence editor (a controlled modal): a Frequency select, an
 * `Every N <unit>` interval stepper, and per-frequency controls — the `S M T W T F S` day row
 * (Weekly), the *On day N* vs *On the [nth] [weekday]* toggle (Monthly), the anchored month+day
 * (Yearly) — plus the End Repeat control (`Never` / `On Date` / `After N`). `OK` assembles the
 * rule and hands it back; `Cancel` discards. State seeds fresh from `initialRule` each open.
 */
export function RecurrenceEditor({
  open,
  onOpenChange,
  initialRule,
  anchorDate,
  onSave,
}: RecurrenceEditorProperties) {
  const [state, setState] = React.useState<EditorState>(() =>
    deriveInitialState(initialRule, anchorDate),
  );

  const unit = FREQ_OPTIONS.find((f) => f.value === state.freq)?.unit ?? 'day';
  const anchor = parseDueDate(anchorDate);

  const weeklyInvalid = state.freq === 'weekly' && state.byweekday.length === 0;
  const intervalInvalid = !Number.isInteger(state.interval) || state.interval < 1;
  const endInvalid =
    (state.endType === 'on_date' && state.until === '') ||
    (state.endType === 'after' && (!Number.isInteger(state.count) || state.count < 1));
  const okDisabled = weeklyInvalid || intervalInvalid || endInvalid;

  const toggleWeekday = (day: Weekday) => {
    setState((s) => ({
      ...s,
      byweekday: s.byweekday.includes(day)
        ? s.byweekday.filter((d) => d !== day)
        : [...s.byweekday, day],
    }));
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} maxWidth="md" className="max-w-sm">
      <DialogTitle className="text-base font-semibold text-foreground">
        Custom recurrence
      </DialogTitle>

      <div className="mt-4 flex flex-col gap-4">
        {/* Frequency */}
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="recurrence-freq">Frequency</FieldLabel>
          <select
            id="recurrence-freq"
            className={selectClass}
            value={state.freq}
            onChange={(e) => {
              setState((s) => ({ ...s, freq: e.target.value as EditorFreq }));
            }}
          >
            {FREQ_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Every N <unit> */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">Every</span>
          <TextField
            type="number"
            min={1}
            aria-label={`Interval in ${unit}s`}
            className="w-16"
            value={String(state.interval)}
            onChange={(e) => {
              setState((s) => ({ ...s, interval: Number.parseInt(e.target.value, 10) || 0 }));
            }}
          />
          <span className="text-sm text-foreground">
            {unit}
            {state.interval === 1 ? '' : 's'}
          </span>
        </div>

        {/* Weekly: S M T W T F S */}
        {state.freq === 'weekly' && (
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="recurrence-weekdays">Days of week</FieldLabel>
            <div
              id="recurrence-weekdays"
              className="flex gap-1"
              role="group"
              aria-label="Days of week"
            >
              {WEEKDAY_TOGGLES.map((d, index) => {
                const pressed = state.byweekday.includes(d.value);
                return (
                  <Button
                    // index disambiguates the duplicate S/T short labels for the React key.
                    key={`${String(d.value)}-${String(index)}`}
                    type="button"
                    variant={pressed ? 'accent' : 'outline'}
                    size="sm"
                    aria-pressed={pressed}
                    aria-label={d.name}
                    onClick={() => {
                      toggleWeekday(d.value);
                    }}
                    className="h-8 w-8 p-0"
                  >
                    {d.short}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly: on day N  |  on the [nth] [weekday] */}
        {state.freq === 'monthly' && (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="recurrence-monthly-mode">Monthly on</FieldLabel>
            <div
              id="recurrence-monthly-mode"
              className="flex flex-col gap-2"
              role="group"
              aria-label="Monthly recurrence mode"
            >
              <Button
                type="button"
                variant={state.monthlyKind === 'day_of_month' ? 'accent' : 'outline'}
                size="sm"
                aria-pressed={state.monthlyKind === 'day_of_month'}
                onClick={() => {
                  setState((s) => ({ ...s, monthlyKind: 'day_of_month' }));
                }}
                className="self-start"
              >
                On day {anchor.getDate()}
              </Button>
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <Button
                  type="button"
                  variant={state.monthlyKind === 'positional' ? 'accent' : 'outline'}
                  size="sm"
                  aria-pressed={state.monthlyKind === 'positional'}
                  onClick={() => {
                    setState((s) => ({ ...s, monthlyKind: 'positional' }));
                  }}
                >
                  On the
                </Button>
                <select
                  aria-label="Which occurrence"
                  className={selectClass}
                  value={String(state.setpos)}
                  onChange={(e) => {
                    setState((s) => ({
                      ...s,
                      setpos: Number.parseInt(e.target.value, 10) as EditorState['setpos'],
                      monthlyKind: 'positional',
                    }));
                  }}
                >
                  {SETPOS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Weekday"
                  className={selectClass}
                  value={String(state.posWeekday)}
                  onChange={(e) => {
                    setState((s) => ({
                      ...s,
                      posWeekday: Number.parseInt(e.target.value, 10) as Weekday,
                      monthlyKind: 'positional',
                    }));
                  }}
                >
                  {WEEKDAY_NAMES.map((name, value) => (
                    <option key={name} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Yearly: month + day, fixed to the anchor date. */}
        {state.freq === 'yearly' && (
          <p className="text-sm text-muted-foreground">
            Repeats every{state.interval === 1 ? '' : ` ${String(state.interval)}`} year
            {state.interval === 1 ? '' : 's'} on{' '}
            <span className="text-foreground">
              {anchor.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
            </span>{' '}
            (the due date).
          </p>
        )}

        {/* End Repeat */}
        <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="recurrence-end">End repeat</FieldLabel>
            <select
              id="recurrence-end"
              className={selectClass}
              value={state.endType}
              onChange={(e) => {
                setState((s) => ({ ...s, endType: e.target.value as RecurrenceEnd['type'] }));
              }}
            >
              <option value="never">Never</option>
              <option value="on_date">On date</option>
              <option value="after">After N occurrences</option>
            </select>
          </div>
          {state.endType === 'on_date' && (
            <TextField
              type="date"
              aria-label="End date"
              value={state.until}
              onChange={(e) => {
                setState((s) => ({ ...s, until: e.target.value }));
              }}
            />
          )}
          {state.endType === 'after' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground">After</span>
              <TextField
                type="number"
                min={1}
                aria-label="Occurrence count"
                className="w-16"
                value={String(state.count)}
                onChange={(e) => {
                  setState((s) => ({ ...s, count: Number.parseInt(e.target.value, 10) || 0 }));
                }}
              />
              <span className="text-sm text-foreground">occurrences</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="accent"
          size="sm"
          disabled={okDisabled}
          onClick={() => {
            onSave(buildRule(state));
            onOpenChange(false);
          }}
        >
          OK
        </Button>
      </div>
    </FormDialog>
  );
}
