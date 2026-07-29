'use client';

import { MoreHorizontal } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import { TextField } from '@/components/atoms/text-field';
import {
  STATUS_WORD,
  formatShortDate,
  minutesToTime,
  timeToMinutes,
} from '@/components/habits/habit-format';
import { SkipPanel } from '@/components/habits/skip-panel';
import { deriveDayStatus, evaluateCriterion } from '@/lib/habits';
import type { DerivedStatus, HabitCriterion, HabitResults } from '@/lib/habits';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import { useHabitActions } from '@/lib/stores/habits-store';
import { cn } from '@/lib/utils';

/** How long a measured commit waits, so Enter-then-blur costs one request rather than two. */
const COMMIT_DELAY_MS = 250;

/** The header's verdict takes the same accent as the cell it was opened from. */
const STATUS_VARIANT: Record<DerivedStatus, 'accent' | 'alert' | 'destructive'> = {
  met: 'accent',
  partial: 'alert',
  missed: 'destructive',
};

interface DayEditorProperties {
  habitId: string;
  date: string;
  criteria: HabitCriterion[];
  /** What the day already records, if anything. */
  results: HabitResults;
  /** Whether the day is currently excused — the header says so instead of a derived verdict. */
  isSkipped: boolean;
  /** Whether the day predates the habit's start, so recording it will move the start back. */
  isBeforeStart: boolean;
  onClose: () => void;
}

/** One criterion's row: its label, and the control that records it. */
function CriterionRow({
  criterion,
  value,
  onCommit,
}: {
  criterion: HabitCriterion;
  value: boolean | number | undefined;
  onCommit: (next: boolean | number | undefined) => void;
}) {
  const outcome = evaluateCriterion(criterion, value);

  if (criterion.kind === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
        <span className="text-xs text-foreground">{criterion.label}</span>
        {/* Tri-state: unrecorded → ✓ → ✕ → unrecorded. An untouched criterion must not read
            as a ✕ — "not recorded" and "recorded as no" are different days. */}
        <CheckboxButton
          aria-label={criterion.label}
          aria-pressed={value === true}
          className={cn(
            'h-[17px] w-[17px] text-[11px] font-bold',
            outcome === 'pass' && 'border-accent-green text-accent-green',
            outcome === 'fail' && 'border-accent-red text-accent-red',
            outcome === 'unrecorded' && 'border-border text-transparent',
          )}
          onClick={() => {
            onCommit(value === undefined ? true : value === true ? false : undefined);
          }}
        >
          {outcome === 'fail' ? '✕' : '✓'}
        </CheckboxButton>
      </div>
    );
  }

  const isTime = criterion.kind === 'time';
  const text = value === undefined ? '' : isTime ? minutesToTime(Number(value)) : String(value);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <span className="text-xs text-foreground">{criterion.label}</span>
      <MeasuredField
        criterion={criterion}
        initialText={text}
        onCommit={(next) => {
          onCommit(next);
        }}
      />
    </div>
  );
}

/**
 * A measured criterion's field. It keeps its own draft while focused so typing never fights
 * the store, and commits on blur or Enter — there is no Save button anywhere in this editor.
 */
function MeasuredField({
  criterion,
  initialText,
  onCommit,
}: {
  criterion: HabitCriterion;
  initialText: string;
  onCommit: (next?: number) => void;
}) {
  const [text, setText] = React.useState(initialText);
  const isTime = criterion.kind === 'time';

  // What the field has already told the store. Blur fires whenever focus leaves — including
  // when the day was merely opened and the ⋯ menu clicked — so without this an untouched
  // empty field would log an empty day, and just LOOKING at an unlogged day would mark it
  // missed.
  const committedRef = React.useRef(initialText);

  const commit = () => {
    if (text === committedRef.current) return;
    committedRef.current = text;
    if (text.trim() === '') {
      onCommit();
      return;
    }
    const parsed = isTime ? timeToMinutes(text) : Number(text);
    onCommit(parsed === undefined || Number.isNaN(parsed) ? undefined : parsed);
  };

  return (
    <TextField
      type={isTime ? 'time' : 'number'}
      aria-label={criterion.label}
      value={text}
      onChange={(event_) => {
        setText(event_.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event_) => {
        if (event_.key === 'Enter') commit();
      }}
      className="w-[92px] px-1.5 py-0.5 text-xs font-mono"
    />
  );
}

/**
 * The footer line, naming what recording this day costs the habit — or, behind its start, what
 * it moves. The start line comes first because it is the bigger consequence and the one the
 * owner has no other way to learn: the days between here and the old start become part of the
 * habit's life, and an unlogged one there spends allowance like any other.
 */
function costLine(status: DerivedStatus, isSkipped: boolean, isBeforeStart: boolean): string {
  if (isBeforeStart) return 'Logging this moves the start back';
  if (isSkipped) return 'Excused — costs nothing';
  return status === 'met' ? 'Earned — costs nothing' : "Spends this week's allowance";
}

/**
 * The day editor: one row per criterion, and a verdict in the header that is COMPUTED, never
 * typed. Because the header re-derives on every change it cannot be made to disagree with the
 * criteria beneath it — that is what "derived only" buys.
 *
 * `skipped` is the one status the model can't derive, so it lives behind the ⋯ overflow rather
 * than as a fourth thing to tap past every morning; the trailing ellipsis is load-bearing, as
 * the item opens a confirm step rather than skipping the day.
 */
export function DayEditor({
  habitId,
  date,
  criteria,
  results,
  isSkipped,
  isBeforeStart,
  onClose,
}: DayEditorProperties) {
  const { logDay, skipDay } = useHabitActions();
  const [draft, setDraft] = React.useState<HabitResults>(results);
  const [mode, setMode] = React.useState<'edit' | 'skip'>('edit');

  // The draft is read back synchronously by the next commit — two changes can land in one
  // tick (blurring a field to click a checkbox), and a state closure would still hold the
  // pre-blur draft. `pending` is whatever the debounce still owes the server.
  const draftRef = React.useRef(draft);
  const pendingRef = React.useRef<HabitResults | undefined>(undefined);

  const send = useDebouncedCallback((next: HabitResults) => {
    pendingRef.current = undefined;
    void logDay(habitId, date, next);
  }, COMMIT_DELAY_MS);

  // The debounce cancels itself on unmount, so a change made in the last fraction of a second
  // before Escape would otherwise be silently dropped. Flush it instead: the editor closing is
  // not a reason to lose the day the owner just recorded.
  React.useEffect(
    () => () => {
      if (pendingRef.current !== undefined) void logDay(habitId, date, pendingRef.current);
    },
    [logDay, habitId, date],
  );

  const commit = (key: string, value: boolean | number | undefined) => {
    // Clearing a field REMOVES its key rather than storing a falsy value — "not recorded" and
    // "recorded as no" are different days, and only an absent key says the first.
    const next: HabitResults = Object.fromEntries(
      Object.entries(draftRef.current).filter(([recorded]) => recorded !== key),
    );
    if (value !== undefined) next[key] = value;
    draftRef.current = next;
    pendingRef.current = next;
    setDraft(next);
    send(next);
  };

  if (mode === 'skip') {
    return (
      <SkipPanel
        date={date}
        onCancel={() => {
          setMode('edit');
        }}
        onSkip={(reason) => {
          void skipDay(habitId, date, reason);
          onClose();
        }}
      />
    );
  }

  const status = deriveDayStatus(criteria, draft);

  return (
    <div className="flex w-[265px] flex-col p-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-foreground">{formatShortDate(date)}</span>
        <Badge variant={isSkipped ? 'muted' : STATUS_VARIANT[status]} className="font-semibold">
          {isSkipped ? STATUS_WORD.skipped : STATUS_WORD[status]}
        </Badge>
      </div>

      {criteria.map((criterion) => (
        <CriterionRow
          key={criterion.key}
          criterion={criterion}
          value={draft[criterion.key]}
          onCommit={(next) => {
            commit(criterion.key, next);
          }}
        />
      ))}

      <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-border pt-1.5">
        {/* Named in the owner's terms, and only when there is a cost to name. */}
        <span className="text-[11px] text-muted-foreground">
          {costLine(status, isSkipped, isBeforeStart)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`More options for ${formatShortDate(date)}`}>
              <MoreHorizontal size={13} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setMode('skip');
              }}
            >
              Mark as skipped…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
