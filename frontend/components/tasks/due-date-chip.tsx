'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Calendar } from '@/components/atoms/calendar';
import { Chip } from '@/components/atoms/chip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';
import { formatDueDate, isDueDateOverdue, isDueToday } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

export interface DueDateChipProperties {
  /** The current due date (`YYYY-MM-DD`), or null when unset. */
  dueDate: string | null;
  /**
   * Persist a picked date (auto-save). Pass this **and** `onClear` to make the chip clickable — it
   * then opens the month-grid calendar. Omit both for a display-only chip (e.g. the Priority view).
   */
  onSelect?: (iso: string) => void;
  /** Clear the due date (auto-save). Pair with `onSelect` to make the chip editable. */
  onClear?: () => void;
  /**
   * `compact` — the row badge (small `text-xs` pill, matching the Type / Repeat / Priority row
   * badges). `comfortable` — the detail-panel chip (larger, matching its Repeat / Priority
   * neighbours). Defaults to `compact`.
   */
  size?: 'compact' | 'comfortable';
  /** Optional accessible-name override for the trigger. */
  'aria-label'?: string;
  /** Extra classes on the trigger. */
  className?: string;
}

/** The urgency band a due date falls in — overdue (past), due today, or still upcoming. */
type DueBand = 'overdue' | 'dueToday' | 'due';

/**
 * Maps a due date to its urgency band: red once overdue, amber the day it's due, blue while still
 * upcoming — matching the folder attention badges' red/amber convention.
 */
function dueBand(dueDate: string): DueBand {
  if (isDueDateOverdue(dueDate)) return 'overdue';
  if (isDueToday(dueDate)) return 'dueToday';
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

/**
 * The one due-date chip, used in both places (ALF-94): the compact badge on a task row and the
 * larger chip in the detail panel. Same red/amber/blue urgency colouring in both, and — when given
 * `onSelect` + `onClear` — clickable in both, opening the month-grid {@link Calendar} to pick or
 * clear a date (auto-save; the pick closes the popover). Without those handlers it's a display-only
 * pill (the Priority view). `size` picks the geometry so it stays consistent with its neighbours in
 * each place; the pill geometry itself lives in the shared {@link Badge} / {@link Chip} atoms.
 */
export function DueDateChip({
  dueDate,
  onSelect,
  onClear,
  size = 'compact',
  className,
  'aria-label': ariaLabel,
}: DueDateChipProperties) {
  const [open, setOpen] = React.useState(false);

  const label = dueDate ? formatDueDate(dueDate) : 'Set a due date…';
  // The row badge announces the value ("Due date: 2025-07-10"); the detail chip is a stable field
  // label ("Due date") so the value rides its visible text. Both contain "due date" for queries.
  const resolvedLabel =
    ariaLabel ?? (size === 'compact' && dueDate ? `Due date: ${dueDate}` : 'Due date');

  const trigger =
    size === 'comfortable' ? (
      <Chip
        aria-label={resolvedLabel}
        className={cn(dueDate ? comfortableTone[dueBand(dueDate)] : comfortableNeutral, className)}
      >
        {label}
      </Chip>
    ) : (
      <Badge
        asButton
        interactive
        variant={dueDate ? dueBand(dueDate) : 'muted'}
        className={cn('font-medium', className)}
        aria-label={resolvedLabel}
      >
        {label}
      </Badge>
    );

  // Display-only when the caller doesn't wire the auto-save handlers (e.g. the Priority view).
  if (onSelect === undefined || onClear === undefined) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent>
        <Calendar
          selected={dueDate}
          onSelect={(iso) => {
            onSelect(iso);
            setOpen(false);
          }}
          onClear={() => {
            onClear();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
