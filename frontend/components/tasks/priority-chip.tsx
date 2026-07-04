'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Chip } from '@/components/atoms/chip';
import { PriorityMenu } from '@/components/tasks/priority-select';
import { type TaskPriority, priorityOption } from '@/lib/priority';
import { cn } from '@/lib/utils';

export interface PriorityChipProperties {
  /** The current level, or null/undefined when unprioritised. */
  priority: TaskPriority | null | undefined;
  /**
   * Persist a level, or null to clear (auto-save). Pass it to make the chip clickable — it then
   * opens the shared {@link PriorityMenu}. Omit for a display-only pill.
   */
  onChange?: (next: TaskPriority | null) => void;
  /**
   * `compact` — the row badge (small `text-xs` pill, matching the Type / Due row badges).
   * `comfortable` — the detail-panel chip (larger, matching its Due / Repeat neighbours).
   * Defaults to `compact`.
   */
  size?: 'compact' | 'comfortable';
  /**
   * Render the icon alone, no text label — the compact row form where space is tight (ALF-67).
   * The level still rides the `aria-label`. Ignored by the `comfortable` size.
   */
  symbolOnly?: boolean;
  /**
   * What to render when there's no level set. Omit to render nothing (the row, which only shows
   * the chip once a level exists); the detail panel passes "No priority", the By-Priority view
   * "Set priority".
   */
  emptyLabel?: string;
  /** Alignment for the picker menu (Radix `align`). Defaults to `start`. */
  menuAlign?: 'start' | 'center' | 'end';
  /** Optional accessible-name override for the trigger. */
  'aria-label'?: string;
  /** Extra classes on the trigger. */
  className?: string;
}

/**
 * The `comfortable` (detail-panel) tone per level — text + faint fill + border. Mirrors the
 * By-Priority / detail convention (low reads blue here, distinct from the row badge's muted grey).
 */
const comfortableTone: Record<TaskPriority, string> = {
  high: 'border-accent-red/30 bg-accent-red/[0.12] text-accent-red',
  medium: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
  low: 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue',
};

/** The neutral (unset) `comfortable` tone — slate text on a faint slate border. */
const comfortableNeutral = 'border-[#25324a] text-[#8A96A8] hover:border-[#34415a]';

/**
 * The one priority chip, used in every place a level shows (ALF-94): the compact badge on a task
 * row and the larger chip in the detail panel / By-Priority view. Owns the priority domain mapping
 * (icon, label, tone per level) and — when given `onChange` — is clickable in all of them, opening
 * the shared {@link PriorityMenu} to re-prioritise (auto-save). `size` picks the geometry so it
 * stays consistent with its neighbours in each place; the pill geometry lives in the shared
 * {@link Badge} / {@link Chip} atoms.
 */
export function PriorityChip({
  priority,
  onChange,
  size = 'compact',
  symbolOnly = false,
  emptyLabel,
  menuAlign = 'start',
  className,
  'aria-label': ariaLabel,
}: PriorityChipProperties) {
  const option = priorityOption(priority);
  // Backstop: an unknown level with no empty affordance requested renders nothing — e.g. a
  // `task_items` row whose `priority` column the read layer dropped (arrives `undefined`). The
  // row's render gate already excludes the unset case; this keeps a stray value from crashing.
  if (option === undefined && emptyLabel === undefined) return null;

  const label = option?.label ?? emptyLabel ?? '';
  // The row badge announces the value ("Priority: High"); the detail chip is a stable field label
  // ("Priority"). Both contain "priority" for queries. The empty compact form (By-Priority's "Set
  // priority") names itself after its own text so the trigger reads as the action.
  const resolvedLabel =
    ariaLabel ??
    (size === 'comfortable'
      ? 'Priority'
      : option
        ? `Priority: ${option.label}`
        : (emptyLabel ?? 'Priority'));

  const trigger =
    size === 'comfortable' ? (
      <Chip
        aria-label={resolvedLabel}
        className={cn(option ? comfortableTone[option.value] : comfortableNeutral, className)}
      >
        {option && <option.icon size={13} strokeWidth={2.6} className="shrink-0" />}
        {label}
      </Chip>
    ) : (
      <Badge
        asButton
        interactive
        variant={option?.badgeVariant ?? 'muted'}
        className={cn('inline-flex items-center gap-1 font-medium hover:opacity-80', className)}
        aria-label={resolvedLabel}
      >
        {option && (
          <option.icon
            size={10}
            strokeWidth={2.5}
            // Symbol-only rows show the glyph alone; size it to the text line-box (16px) so the
            // pill stands the same height as its Type / Due / count neighbours (ALF-94).
            className={cn('shrink-0', symbolOnly && 'h-4 w-4')}
          />
        )}
        {!symbolOnly && label}
      </Badge>
    );

  // Display-only when the caller doesn't wire the auto-save handler (kept for flexibility).
  if (onChange === undefined) return trigger;

  return (
    <PriorityMenu value={option?.value ?? null} onChange={onChange} align={menuAlign}>
      {trigger}
    </PriorityMenu>
  );
}
