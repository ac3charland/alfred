'use client';

import { Lock } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Chip } from '@/components/atoms/chip';
import { DialogDescription, DialogTitle } from '@/components/atoms/dialog';
import { OptionButton } from '@/components/atoms/option-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';
import { TextField } from '@/components/atoms/text-field';
import { ToggleButton } from '@/components/atoms/toggle-button';
import {
  CriterionEditor,
  type CriterionShape,
  KIND_OPTIONS,
} from '@/components/habits/criterion-editor';
import {
  criterionKeyFrom,
  formatAllowanceSlot,
  formatDaysSlot,
  formatTarget,
  lockedReason,
  lockedSlotName,
  weekdayName,
} from '@/components/habits/habit-format';
import type { LockedSlot } from '@/components/habits/habit-format';
import type { CriterionKind, HabitCriterion, LoggedDays } from '@/lib/habits';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { cn } from '@/lib/utils';

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const ALLOWANCES = [0, 1, 2, 3, 4, 5, 6, 7];

/** The dashed-underline slot: a real control that happens to sit inline in a sentence. */
const SLOT_CLASS =
  'rounded-none border-0 border-b-2 border-dashed border-accent-teal px-1 py-0 text-[15px] text-accent-teal';
/**
 * A frozen slot: still a real button, but a muted plate with a padlock instead of the teal
 * dashed underline. It keeps its button role deliberately — a control that simply doesn't
 * respond gets clicked again, and then reported as a bug. Clicking this one answers.
 */
const LOCKED_SLOT_CLASS =
  'gap-1 rounded-sm border-0 bg-secondary/40 px-1.5 py-0.5 text-[15px] text-muted-foreground';
/** The pill slot a criterion chip takes, so the sentence's nouns read as objects. */
const CHIP_CLASS =
  'border-accent-teal bg-accent-teal/10 px-2.5 py-0.5 text-[13px] text-accent-teal';

/** How a criterion reads inside the sentence: its label, plus its target when it has one. */
function criterionPhrase(criterion: HabitCriterion): string {
  return criterion.kind === 'boolean'
    ? criterion.label
    : `${criterion.label} ${formatTarget(criterion)}`;
}

/** What the sentence says, in the shape the form edits it. */
export interface HabitSentenceValues {
  name: string;
  criteria: HabitCriterion[];
  activeDays: number[];
  allowance: number;
}

interface HabitSentenceFormProperties {
  title: string;
  description: string;
  /** Present when editing — the sentence opens reading this habit back. */
  initial?: HabitSentenceValues | undefined;
  /**
   * The habit's logged days. Any at all freezes the cadence slots: those two are not stored per
   * day, so changing them would restate chain the owner already earned. Absent (or zero) leaves
   * every slot open — a habit with no history has nothing to protect.
   */
  logged?: LoggedDays | undefined;
  submitLabel: string;
  pendingLabel: string;
  /** A function here reads the rejection, so a route's own explanation can be quoted. */
  errorMessage: string | ((error: unknown) => string);
  onCancel: () => void;
  onSubmit: (values: HabitSentenceValues) => Promise<unknown>;
}

/**
 * What a frozen slot says when it is clicked: the rule, the count behind it, and the thing that
 * CAN still be changed — so the answer ends somewhere useful rather than at "no".
 *
 * Exported for its own visual baseline: this explanation is half of the locked-slot treatment,
 * and a PNG is the only thing that keeps a wall of small muted text from drifting.
 */
export function LockedSlotExplanation({ slot, logged }: { slot: LockedSlot; logged: LoggedDays }) {
  return (
    <div className="w-[262px]">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Lock size={12} aria-hidden="true" />
        Fixed for this habit
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {lockedReason(slot, logged)}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        You can still change{' '}
        <b className="font-semibold text-foreground">what counts as a good day</b> — edit a
        criterion above.
      </p>
    </div>
  );
}

/**
 * A frozen cadence slot and the popover that explains it — the same popover shape the editable
 * slots open, so this is a content change rather than a new pattern. Its accessible name leads
 * with "Locked", so the state is announced before the value.
 */
export function LockedCadenceSlot({
  slot,
  label,
  value,
  logged,
}: {
  slot: LockedSlot;
  label: string;
  value: string;
  logged: LoggedDays;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip className={LOCKED_SLOT_CLASS} aria-label={lockedSlotName(label, value)}>
          <Lock size={11} aria-hidden="true" />
          {value}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="p-3">
        <LockedSlotExplanation slot={slot} logged={logged} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The habit sentence: ONE editable sentence, not a stacked field list. Each underlined slot is a
 * real labelled control that opens a small popover and writes its result back inline, so the
 * shape reads as a sentence without costing keyboard users a form.
 *
 * The `+` is kind-first: it opens a menu naming what a criterion can BE, with an example each,
 * and only then the fields that kind needs. That teaches the concept while it is still new,
 * never shows an irrelevant field, and maps one-to-one onto the discriminated union the API
 * validates — the same two-step `lib/recurrence` already uses for repeat rules.
 *
 * Creating a habit and changing one are the same sentence with different initial values, so this
 * is built once and mounted from both dialogs. A second copy would be a second place criterion
 * keys get minted, and key minting is the one piece of this form that stored history depends on.
 */
export function HabitSentenceForm({
  title,
  description,
  initial,
  logged,
  submitLabel,
  pendingLabel,
  errorMessage,
  onCancel,
  onSubmit,
}: HabitSentenceFormProperties) {
  const [name, setName] = React.useState(initial?.name ?? '');
  const [criteria, setCriteria] = React.useState<HabitCriterion[]>(initial?.criteria ?? []);
  const [activeDays, setActiveDays] = React.useState<number[]>(initial?.activeDays ?? ISO_WEEKDAYS);
  const [allowance, setAllowance] = React.useState(initial?.allowance ?? 0);
  const [openSlot, setOpenSlot] = React.useState<string | undefined>();
  const [addKind, setAddKind] = React.useState<CriterionKind | undefined>();
  const nameRef = React.useRef<HTMLInputElement>(null);

  // The cadence is frozen the moment there is one day to protect — and the count that froze it
  // is what the explanation quotes, so the two travel together rather than as a flag and a value.
  const lockedBy = logged !== undefined && logged.count > 0 ? logged : undefined;

  // The dialog suppresses Radix's own auto-focus so the sentence isn't read from its middle;
  // the name is where writing one starts, so focus lands there.
  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const slotProps = (id: string) => ({
    open: openSlot === id,
    onOpenChange: (open: boolean) => {
      setOpenSlot(open ? id : undefined);
      if (!open) setAddKind(undefined);
    },
  });

  const upsertCriterion = (index: number | undefined, shape: CriterionShape) => {
    setCriteria((current) => {
      const existing = index === undefined ? undefined : current[index];
      // The key is frozen once the criterion exists: renaming its label later must not orphan
      // the results already stored against it.
      const key =
        existing?.key ??
        criterionKeyFrom(
          shape.label,
          current.map((criterion) => criterion.key),
        );
      const next: HabitCriterion = { ...shape, key };
      return index === undefined
        ? [...current, next]
        : current.map((criterion, at) => (at === index ? next : criterion));
    });
    setOpenSlot(undefined);
    setAddKind(undefined);
  };

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () => onSubmit({ name: name.trim(), criteria, activeDays, allowance }),
    onSuccess: onCancel,
    errorMessage,
  });

  const canSubmit =
    name.trim() !== '' && criteria.length > 0 && activeDays.length > 0 && !isPending;

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">{title}</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        {description}
      </DialogDescription>

      <div className="mt-5 flex flex-col gap-3">
        <TextField
          aria-label="Habit name"
          value={name}
          ref={nameRef}
          onChange={(event_) => {
            setName(event_.target.value);
          }}
          placeholder="Morning routine"
          className="px-3 py-2 text-[15px]"
        />

        <p className="text-[15px] leading-[2.2] text-foreground">
          Every{' '}
          {lockedBy === undefined ? (
            <Popover {...slotProps('days')}>
              <PopoverTrigger asChild>
                <Chip className={SLOT_CLASS} aria-label={`Days: ${formatDaysSlot(activeDays)}`}>
                  {formatDaysSlot(activeDays)}
                </Chip>
              </PopoverTrigger>
              <PopoverContent className="p-2">
                <div className="flex flex-wrap gap-1">
                  {ISO_WEEKDAYS.map((day) => (
                    <ToggleButton
                      key={day}
                      pressed={activeDays.includes(day)}
                      onToggle={() => {
                        setActiveDays((current) =>
                          current.includes(day)
                            ? current.filter((other) => other !== day)
                            : [...current, day],
                        );
                      }}
                    >
                      <span className="sr-only">{weekdayName(day)}</span>
                      <span aria-hidden="true">{weekdayName(day).slice(0, 3)}</span>
                    </ToggleButton>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <LockedCadenceSlot
              slot="days"
              label="Days:"
              value={formatDaysSlot(activeDays)}
              logged={lockedBy}
            />
          )}{' '}
          I will{' '}
          {criteria.map((criterion, index) => (
            <React.Fragment key={criterion.key}>
              {index > 0 && <span> and </span>}
              <Popover {...slotProps(`criterion:${criterion.key}`)}>
                <PopoverTrigger asChild>
                  <Chip
                    className={CHIP_CLASS}
                    aria-label={`Edit criterion: ${criterionPhrase(criterion)}`}
                  >
                    {criterionPhrase(criterion)}
                  </Chip>
                </PopoverTrigger>
                <PopoverContent className="p-0">
                  <CriterionEditor
                    kind={criterion.kind}
                    initial={criterion}
                    onSave={(shape) => {
                      upsertCriterion(index, shape);
                    }}
                    onRemove={() => {
                      setCriteria((current) => current.filter((_, at) => at !== index));
                      setOpenSlot(undefined);
                    }}
                    onCancel={() => {
                      setOpenSlot(undefined);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </React.Fragment>
          ))}{' '}
          <Popover {...slotProps('add')}>
            <PopoverTrigger asChild>
              <Chip className={cn(SLOT_CLASS, 'font-semibold')} aria-label="Add a criterion">
                +
              </Chip>
            </PopoverTrigger>
            <PopoverContent className="p-0">
              {addKind === undefined ? (
                <div className="flex w-[230px] flex-col gap-0.5 p-1">
                  {KIND_OPTIONS.map((option) => (
                    <OptionButton
                      key={option.kind}
                      className="px-2 py-1.5 text-xs"
                      onClick={() => {
                        setAddKind(option.kind);
                      }}
                    >
                      <span>{option.label}</span>
                      <span className="text-[11px] text-muted-foreground">{option.hint}</span>
                    </OptionButton>
                  ))}
                </div>
              ) : (
                <CriterionEditor
                  kind={addKind}
                  onSave={(shape) => {
                    upsertCriterion(undefined, shape);
                  }}
                  onCancel={() => {
                    setAddKind(undefined);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          <br />
          forgiving{' '}
          {lockedBy === undefined ? (
            <Popover {...slotProps('allowance')}>
              <PopoverTrigger asChild>
                <Chip
                  className={SLOT_CLASS}
                  aria-label={`Allowance: ${formatAllowanceSlot(allowance)}`}
                >
                  {formatAllowanceSlot(allowance)}
                </Chip>
              </PopoverTrigger>
              <PopoverContent className="p-1">
                <div className="flex w-[170px] flex-col gap-0.5">
                  {ALLOWANCES.map((option) => (
                    <OptionButton
                      key={option}
                      selected={allowance === option}
                      className="px-2 py-1 text-xs"
                      onClick={() => {
                        setAllowance(option);
                        setOpenSlot(undefined);
                      }}
                    >
                      {formatAllowanceSlot(option)}
                    </OptionButton>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <LockedCadenceSlot
              slot="slack"
              label="Allowance:"
              value={formatAllowanceSlot(allowance)}
              logged={lockedBy}
            />
          )}
          .
        </p>
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" disabled={!canSubmit} onClick={() => void submit()}>
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </>
  );
}
