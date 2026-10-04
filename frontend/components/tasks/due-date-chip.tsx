'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Chip } from '@/components/atoms/chip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';
import { DueDatePicker } from '@/components/tasks/due-date-picker';
import {
  formatDueLabel,
  isPastDue,
  lateness,
  localISODate,
  normalizeDueTime,
  parseDueDate,
} from '@/lib/date-utils';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils';

export interface DueDateChipProperties {
  /** The current due date (`YYYY-MM-DD`), or null when unset. */
  dueDate: string | null;
  /** The due time (`HH:MM`, or the `HH:MM:SS` a row carries), or null when due any time that day. */
  dueTime?: string | null | undefined;
  /**
   * Persist a picked date (auto-save). Pass this **and** `onClear` to make the chip clickable — it
   * then opens the due-date picker. Omit both for a display-only chip (e.g. the Priority view).
   */
  onSelect?: (iso: string) => void;
  /** Clear the due date — and its time (auto-save). Pair with `onSelect` to make the chip editable. */
  onClear?: () => void;
  /** Persist a committed time, or null to clear just the time. Adds the picker's time row. */
  onSetTime?: (time: string | null) => void;
  /**
   * `compact` — the row badge (small `text-xs` pill, matching the Type / Repeat / Priority row
   * badges). `comfortable` — the detail-panel chip (larger, matching its Repeat / Priority
   * neighbours). Defaults to `compact`.
   */
  size?: 'compact' | 'comfortable';
  /**
   * Render a non-interactive `<span>` (no button, no picker) — for the select-mode row, where
   * the whole row is one button and a nested control would be invalid HTML.
   */
  inert?: boolean;
  /** Optional accessible-name override for the trigger. */
  'aria-label'?: string;
  /** Extra classes on the trigger. */
  className?: string;
}

/** The urgency band a due date falls in — overdue (past), due today, or still upcoming. */
type DueBand = 'overdue' | 'dueToday' | 'due';

/**
 * Maps a due date (and time) to its urgency band at `now`: red once past due, amber the day it's
 * due, blue while still upcoming — matching the folder attention badges' red/amber convention. A
 * timed task due today is amber until its minute, then red; an untimed one is amber all day.
 */
function dueBand(dueDate: string, dueTime: string | null, now: Date): DueBand {
  if (isPastDue(dueDate, dueTime, now)) return 'overdue';
  if (localISODate(parseDueDate(dueDate)) === localISODate(now)) return 'dueToday';
  return 'due';
}

/**
 * The `comfortable` (detail-panel) urgency tone — text + faint fill + border, matching the
 * priority detail chip; the blue "upcoming" reads like the old always-blue "set" chip.
 */
const comfortableTone: Record<DueBand, string> = {
  overdue: 'border-accent-red/30 bg-accent-red/[0.12] text-accent-red hover:border-accent-red/50',
  dueToday:
    'border-accent-amber/30 bg-accent-amber/10 text-accent-amber hover:border-accent-amber/50',
  due: 'border-accent-blue/30 bg-accent-blue/[0.08] text-accent-blue hover:border-accent-blue/50',
};

/** The neutral (unset) `comfortable` tone — slate text on a faint slate border. */
const comfortableNeutral = 'border-[#25324a] text-[#8A96A8] hover:border-[#34415a]';

interface TriggerProperties extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  dueDate: string | null;
  dueTime: string | null;
  size: 'compact' | 'comfortable';
  inert: boolean;
}

interface TriggerViewProperties extends Omit<TriggerProperties, 'dueDate' | 'dueTime'> {
  /** The urgency band, or null for an unset date (neutral tone). */
  band: DueBand | null;
}

/** The chip's visible pill in its three forms — inert badge, row badge button, detail chip. */
const TriggerView = React.forwardRef<HTMLButtonElement, TriggerViewProperties>(
  ({ band, size, inert, className, children, ...properties }, reference) => {
    if (inert) {
      return (
        <Badge
          variant={band ?? 'muted'}
          className={cn('font-medium', className)}
          aria-label={properties['aria-label']}
        >
          {children}
        </Badge>
      );
    }
    if (size === 'comfortable') {
      return (
        <Chip
          ref={reference}
          {...properties}
          className={cn(band === null ? comfortableNeutral : comfortableTone[band], className)}
        >
          {children}
        </Chip>
      );
    }
    return (
      <Badge
        ref={reference}
        asButton
        interactive
        {...properties}
        variant={band ?? 'muted'}
        className={cn('font-medium', className)}
      >
        {children}
      </Badge>
    );
  },
);
TriggerView.displayName = 'TriggerView';

/**
 * A timed chip's trigger: the only form that holds a ticking clock, so a timed task due today
 * turns red at its minute without a reload while untimed chips (whose band can't change during a
 * day) keep no timer at all.
 */
const TimedTrigger = React.forwardRef<
  HTMLButtonElement,
  TriggerProperties & { dueDate: string; dueTime: string }
>(({ dueDate, dueTime, ...properties }, reference) => {
  const now = lateness(useNow(60_000), useHydrated());
  return <TriggerView ref={reference} band={dueBand(dueDate, dueTime, now)} {...properties} />;
});
TimedTrigger.displayName = 'TimedTrigger';

/**
 * Picks the trigger form. Only the pill swaps when a time is added or cleared — the popover
 * around it (and its open state) stays mounted, so a time commit leaves the picker open.
 */
const DueTrigger = React.forwardRef<HTMLButtonElement, TriggerProperties>(
  ({ dueDate, dueTime, ...properties }, reference) => {
    if (dueDate !== null && dueTime !== null) {
      return <TimedTrigger ref={reference} dueDate={dueDate} dueTime={dueTime} {...properties} />;
    }
    const band = dueDate === null ? null : dueBand(dueDate, null, new Date());
    return <TriggerView ref={reference} band={band} {...properties} />;
  },
);
DueTrigger.displayName = 'DueTrigger';

/**
 * The one due-date chip, used in both places (ALF-94): the compact badge on a task row and the
 * larger chip in the detail panel. Same red/amber/blue urgency colouring in both, and — when given
 * `onSelect` + `onClear` — clickable in both, opening the shared {@link DueDatePicker} to pick or
 * clear a date or set a time (auto-save; a day pick closes the popover, a time commit doesn't).
 * Without those handlers it's a display-only pill (the Priority view). A timed chip reads date +
 * time ("Today 3 PM"). `size` picks the geometry so it stays consistent with its neighbours in
 * each place; the pill geometry itself lives in the shared {@link Badge} / {@link Chip} atoms.
 */
export function DueDateChip({
  dueDate,
  dueTime: rawDueTime,
  onSelect,
  onClear,
  onSetTime,
  size = 'compact',
  inert = false,
  className,
  'aria-label': ariaLabel,
}: DueDateChipProperties) {
  const [open, setOpen] = React.useState(false);
  const dueTime = dueDate === null ? null : normalizeDueTime(rawDueTime);
  // The device's clock format is the browser's to know; until hydration ends, render the label
  // the server can reproduce (en-US), then the device's own straight after.
  const hydrated = useHydrated();

  const label = dueDate
    ? formatDueLabel(dueDate, dueTime, hydrated ? undefined : 'en-US')
    : 'Set a due date…';
  // The row badge announces the value ("Due date: 2025-07-10 15:00"); the detail chip is a stable
  // field label ("Due date") so the value rides its visible text. Both contain "due date" for
  // queries.
  const value = dueDate === null ? '' : dueTime === null ? dueDate : `${dueDate} ${dueTime}`;
  const resolvedLabel =
    ariaLabel ?? (size === 'compact' && dueDate ? `Due date: ${value}` : 'Due date');

  const trigger = (
    <DueTrigger
      dueDate={dueDate}
      dueTime={dueTime}
      size={size}
      inert={inert}
      aria-label={resolvedLabel}
      className={className}
    >
      {label}
    </DueTrigger>
  );

  // Display-only when the caller doesn't wire the auto-save handlers (e.g. the Priority view).
  if (inert || onSelect === undefined || onClear === undefined) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent>
        <DueDatePicker
          dueDate={dueDate}
          dueTime={dueTime}
          onSelect={(iso) => {
            onSelect(iso);
            setOpen(false);
          }}
          onClear={() => {
            onClear();
            setOpen(false);
          }}
          onSetTime={onSetTime}
        />
      </PopoverContent>
    </Popover>
  );
}
