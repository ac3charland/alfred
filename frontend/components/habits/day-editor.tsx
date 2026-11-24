'use client';

import { MoreHorizontal } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { UnitField } from '@/components/atoms/unit-field';
import {
  DURATION_UNIT,
  STATUS_WORD,
  formatShortDate,
  minutesToTime,
  rescoreNotice,
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
  /**
   * The verdict frozen on this day when it was written, if it is logged. Compared against what
   * today's criteria would give the same results, so a definition that moved under a logged day
   * is named rather than left to happen quietly on the next save.
   */
  storedStatus?: DerivedStatus | undefined;
  /** Whether the day is currently excused — the header says so instead of a derived verdict. */
  isSkipped: boolean;
  /** Why an excused day was skipped, if it is skipped and the reason was recorded. */
  skipReason: string | null;
  /** Whether the day predates the habit's start, so recording it will move the start back. */
  isBeforeStart: boolean;
  onClose: () => void;
  /**
   * Thumb-sized: full-width rows, 44px controls, Yes / No buttons in place of the cycling box, and
   * a Done button. For the bottom sheet a touch device opens; off, the dense popover layout.
   */
  touch?: boolean;
  /** The habit's name, shown under the date in touch mode — the sheet covers the card that said so. */
  habitName?: string;
}

/** A measured field's draft not yet told to the store; `value` is absent for a cleared field. */
interface FieldDraft {
  value: number | undefined;
}

/**
 * Hand over a field's untold draft, marking it told. `undefined` when there is nothing new, so
 * opening and closing an unlogged day never logs it.
 */
type TakeDraft = () => FieldDraft | undefined;

/** Lets each measured field offer the editor its draft when the editor closes. */
type RegisterField = (key: string, take: TakeDraft) => () => void;

/** The results with one criterion set — or REMOVED, when `value` is undefined. */
function withResult(
  results: HabitResults,
  key: string,
  value: boolean | number | undefined,
): HabitResults {
  // Clearing a field REMOVES its key rather than storing a falsy value — "not recorded" and
  // "recorded as no" are different days, and only an absent key says the first.
  const next: HabitResults = Object.fromEntries(
    Object.entries(results).filter(([recorded]) => recorded !== key),
  );
  if (value !== undefined) next[key] = value;
  return next;
}

/** A typed field's text as the number the store keeps: minutes after midnight for a time. */
function parseMeasured(kind: HabitCriterion['kind'], text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const parsed = kind === 'time' ? timeToMinutes(text) : Number(text);
  return parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * A yes/no criterion on a touch device: two buttons rather than the cycling box, because reaching
 * ✕ through ✓ lets one slip or double-tap record the opposite answer. Tapping the lit one clears
 * the criterion — the model still needs "not recorded" as distinct from "recorded as no".
 */
function YesNo({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: boolean | undefined;
  onCommit: (next: boolean | undefined) => void;
}) {
  const answer = (pick: boolean) => {
    onCommit(value === pick ? undefined : pick);
  };
  const half = 'h-11 min-w-[72px] justify-center px-3 text-[15px]';
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-2">
      {/* The glyphs sit beside the words, so the answer never rests on colour alone. */}
      <ToggleButton
        pressed={value === true}
        tone="affirm"
        className={half}
        onToggle={() => {
          answer(true);
        }}
      >
        <span aria-hidden="true">✓</span> Yes
      </ToggleButton>
      <ToggleButton
        pressed={value === false}
        tone="deny"
        className={half}
        onToggle={() => {
          answer(false);
        }}
      >
        <span aria-hidden="true">✕</span> No
      </ToggleButton>
    </div>
  );
}

/** One criterion's row: its label, and the control that records it. */
function CriterionRow({
  criterion,
  value,
  onCommit,
  register,
  touch,
}: {
  criterion: HabitCriterion;
  value: boolean | number | undefined;
  onCommit: (next: boolean | number | undefined) => void;
  register: RegisterField;
  touch: boolean;
}) {
  const outcome = evaluateCriterion(criterion, value);
  // On touch a long label wraps beside a control that keeps its size.
  const row = touch
    ? 'flex min-h-14 items-center justify-between gap-3 border-b border-border py-2 last:border-b-0'
    : 'flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0';
  const label = (
    <span className={touch ? 'min-w-0 text-[15px] text-foreground' : 'text-xs text-foreground'}>
      {criterion.label}
    </span>
  );

  if (criterion.kind === 'boolean') {
    if (touch) {
      return (
        <div className={row}>
          {label}
          <YesNo
            label={criterion.label}
            value={typeof value === 'boolean' ? value : undefined}
            onCommit={onCommit}
          />
        </div>
      );
    }
    return (
      <div className={row}>
        {label}
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
    <div className={row}>
      {label}
      <MeasuredField
        criterion={criterion}
        initialText={text}
        onCommit={(next) => {
          onCommit(next);
        }}
        register={register}
        touch={touch}
      />
    </div>
  );
}

/**
 * A measured criterion's field. It keeps its own draft while focused so typing never fights
 * the store, and commits on blur or Enter — there is no Save button anywhere in this editor.
 *
 * Neither is guaranteed before the field goes away: tapping a button need not blur a field in
 * iOS Safari, and a removed element fires no blur. So the field also offers its draft to the
 * editor, which collects it when the editor closes; and if the field alone goes (the skip step
 * replacing the rows), it commits its own draft on the way out.
 */
function MeasuredField({
  criterion,
  initialText,
  onCommit,
  register,
  touch,
}: {
  criterion: HabitCriterion;
  initialText: string;
  onCommit: (next?: number) => void;
  register: RegisterField;
  touch: boolean;
}) {
  const [text, setText] = React.useState(initialText);
  const isTime = criterion.kind === 'time';
  const { key, kind } = criterion;

  // Read by the unmount path, which runs after the last render's closures are gone.
  const textRef = React.useRef(initialText);
  // What the field has already told the store. Blur fires whenever focus leaves — including
  // when the day was merely opened and the ⋯ menu clicked — so without this an untouched
  // empty field would log an empty day, and just LOOKING at an unlogged day would mark it
  // missed.
  const committedRef = React.useRef(initialText);
  const onCommitRef = React.useRef(onCommit);
  React.useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const take = React.useCallback((): FieldDraft | undefined => {
    if (textRef.current === committedRef.current) return undefined;
    committedRef.current = textRef.current;
    return { value: parseMeasured(kind, textRef.current) };
  }, [kind]);

  React.useEffect(() => {
    const unregister = register(key, take);
    return () => {
      unregister();
      // A no-op once the closing editor has collected the draft; otherwise the editor is still
      // open, and this is an ordinary commit.
      const draft = take();
      if (draft !== undefined) onCommitRef.current(draft.value);
    };
  }, [register, key, take]);

  const commit = () => {
    const draft = take();
    if (draft !== undefined) onCommit(draft.value);
  };

  return (
    <UnitField
      type={isTime ? 'time' : 'number'}
      // The value stored for a duration is bare minutes; nothing else on this row says so.
      unit={criterion.kind === 'duration' ? DURATION_UNIT : undefined}
      aria-label={criterion.label}
      value={text}
      onChange={(event_) => {
        textRef.current = event_.target.value;
        setText(event_.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event_) => {
        if (event_.key === 'Enter') commit();
      }}
      {...(touch && !isTime ? { inputMode: 'decimal', enterKeyHint: 'done' } : {})}
      className={
        touch
          ? cn('h-11 px-2 text-base font-mono', isTime ? 'min-w-[104px]' : 'w-[72px]')
          : 'w-[92px] px-1.5 py-0.5 text-xs font-mono'
      }
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
  storedStatus,
  isSkipped,
  skipReason,
  isBeforeStart,
  onClose,
  touch = false,
  habitName,
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

  // Each measured field's way to hand over a draft it has not committed yet.
  const fieldsRef = React.useRef(new Map<string, TakeDraft>());
  const register = React.useCallback<RegisterField>((key, take) => {
    fieldsRef.current.set(key, take);
    return () => {
      if (fieldsRef.current.get(key) === take) fieldsRef.current.delete(key);
    };
  }, []);

  // The debounce cancels itself on unmount, so a change made in the last fraction of a second
  // before Escape would otherwise be silently dropped. Flush it instead — with any field's typed
  // but uncommitted value folded in, in one write: the editor closing is not a reason to lose
  // the day the owner just recorded. The fields' own cleanups run after this one (React unmounts
  // parents first), so this is the last moment the editor can still send what they hold.
  React.useEffect(
    () => () => {
      let next = pendingRef.current;
      for (const [key, take] of fieldsRef.current) {
        const field = take();
        if (field !== undefined) next = withResult(next ?? draftRef.current, key, field.value);
      }
      pendingRef.current = undefined;
      if (next !== undefined) void logDay(habitId, date, next);
    },
    [logDay, habitId, date],
  );

  const commit = (key: string, value: boolean | number | undefined) => {
    const next = withResult(draftRef.current, key, value);
    draftRef.current = next;
    pendingRef.current = next;
    setDraft(next);
    send(next);
  };

  if (mode === 'skip') {
    return (
      <SkipPanel
        date={date}
        touch={touch}
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

  // Measured against the STORED results, not the draft: an edit in progress is expected to move
  // the verdict, while the same results scoring differently than they did means the criteria
  // moved underneath this day. Only the second is worth saying.
  const storedNow = deriveDayStatus(criteria, results);
  const rescore =
    !isSkipped && storedStatus !== undefined && storedStatus !== storedNow
      ? rescoreNotice(storedStatus, storedNow)
      : undefined;

  const verdict = (
    <Badge
      variant={isSkipped ? 'muted' : STATUS_VARIANT[status]}
      className={cn('font-semibold', touch && 'text-[13px]')}
    >
      {isSkipped ? STATUS_WORD.skipped : STATUS_WORD[status]}
    </Badge>
  );

  // A skipped day's criteria never produced its verdict — Skipped is never derived — so
  // re-showing them as blank checkboxes would misrepresent why the day reads this way, and
  // toggling one would silently re-log the day out from under the skip. The reason is what
  // actually explains this square.
  const body = isSkipped
    ? skipReason !== null &&
      skipReason.trim() !== '' && (
        <p
          className={cn(
            'border-b border-border leading-relaxed text-foreground last:border-b-0',
            touch ? 'py-2 text-[15px]' : 'py-1.5 text-xs',
          )}
        >
          {skipReason.trim()}
        </p>
      )
    : criteria.map((criterion) => (
        <CriterionRow
          key={criterion.key}
          criterion={criterion}
          value={draft[criterion.key]}
          onCommit={(next) => {
            commit(criterion.key, next);
          }}
          register={register}
          touch={touch}
        />
      ));

  return (
    // On touch the editor fills the sheet, and only the rows scroll when they don't fit: the
    // header, the cost line and Done stay where a thumb can find them.
    <div
      className={
        touch ? 'flex min-h-0 flex-1 flex-col px-4 pt-4 pb-4' : 'flex w-[265px] flex-col p-2'
      }
    >
      {touch ? (
        <div className="mb-2 flex shrink-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-base font-semibold text-foreground">{formatShortDate(date)}</span>
            {habitName !== undefined && (
              <span className="text-[13px] text-muted-foreground">{habitName}</span>
            )}
          </div>
          {verdict}
        </div>
      ) : (
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-foreground">{formatShortDate(date)}</span>
          {verdict}
        </div>
      )}

      {touch ? <div className="min-h-0 flex-1 overflow-y-auto">{body}</div> : body}

      {rescore !== undefined && (
        <p
          className={cn(
            'mt-1.5 shrink-0 border-t border-border pt-1.5 leading-snug text-accent-amber',
            touch ? 'text-[13px]' : 'text-[11px]',
          )}
        >
          {rescore}
        </p>
      )}

      <div className="mt-1.5 flex shrink-0 items-center justify-between gap-3 border-t border-border pt-1.5">
        {/* Named in the owner's terms, and only when there is a cost to name. */}
        <span className={cn('text-muted-foreground', touch ? 'text-[13px]' : 'text-[11px]')}>
          {costLine(status, isSkipped, isBeforeStart)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              className={touch ? 'h-11 w-11' : undefined}
              aria-label={`More options for ${formatShortDate(date)}`}
            >
              <MoreHorizontal size={touch ? 18 : 13} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className={touch ? 'min-h-11 text-[15px]' : undefined}
              onSelect={() => {
                setMode('skip');
              }}
            >
              Mark as skipped…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nothing here needs saving — every change commits itself. Done is the thumb-sized way out
          a sheet with no visible exit would otherwise lack. */}
      {touch && (
        <Button variant="secondary" className="mt-3 h-11 w-full shrink-0" onClick={onClose}>
          Done
        </Button>
      )}
    </div>
  );
}
