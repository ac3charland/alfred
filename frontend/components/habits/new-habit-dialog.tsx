'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Chip } from '@/components/atoms/chip';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
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
  weekdayName,
} from '@/components/habits/habit-format';
import type { CreateHabitInput } from '@/lib/api-client';
import type { CriterionKind, HabitCriterion } from '@/lib/habits';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { Habit } from '@/lib/types';
import { cn } from '@/lib/utils';

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const ALLOWANCES = [0, 1, 2, 3, 4, 5, 6, 7];

/** The dashed-underline slot: a real control that happens to sit inline in a sentence. */
const SLOT_CLASS =
  'rounded-none border-0 border-b-2 border-dashed border-accent-teal px-1 py-0 text-[15px] text-accent-teal';
/** The pill slot a criterion chip takes, so the sentence's nouns read as objects. */
const CHIP_CLASS =
  'border-accent-teal bg-accent-teal/10 px-2.5 py-0.5 text-[13px] text-accent-teal';

/** How a criterion reads inside the sentence: its label, plus its target when it has one. */
function criterionPhrase(criterion: HabitCriterion): string {
  return criterion.kind === 'boolean'
    ? criterion.label
    : `${criterion.label} ${formatTarget(criterion)}`;
}

interface NewHabitDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateHabitInput) => Promise<Habit>;
}

/**
 * The create form: ONE editable sentence, not a stacked field list. Each underlined slot is a
 * real labelled control that opens a small popover and writes its result back inline, so the
 * shape reads as a sentence without costing keyboard users a form.
 *
 * The `+` is kind-first: it opens a menu naming what a criterion can BE, with an example each,
 * and only then the fields that kind needs. That teaches the concept while it is still new,
 * never shows an irrelevant field, and maps one-to-one onto the discriminated union the API
 * validates — the same two-step `lib/recurrence` already uses for repeat rules.
 */
function NewHabitForm({ onOpenChange, onCreate }: Omit<NewHabitDialogProperties, 'open'>) {
  const [name, setName] = React.useState('');
  const [criteria, setCriteria] = React.useState<HabitCriterion[]>([]);
  const [activeDays, setActiveDays] = React.useState<number[]>(ISO_WEEKDAYS);
  const [allowance, setAllowance] = React.useState(0);
  const [openSlot, setOpenSlot] = React.useState<string | undefined>();
  const [addKind, setAddKind] = React.useState<CriterionKind | undefined>();
  const nameRef = React.useRef<HTMLInputElement>(null);

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
    onSubmit: () =>
      onCreate({
        name: name.trim(),
        criteria,
        active_days: activeDays,
        allowance,
      }),
    onSuccess: () => {
      onOpenChange(false);
    },
    errorMessage: 'Could not create the habit. Try again.',
  });

  const canSubmit =
    name.trim() !== '' && criteria.length > 0 && activeDays.length > 0 && !isPending;

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">New habit</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        Say what you&apos;ll do, on which days, and how much slack you get.
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
          </Popover>{' '}
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
          .
        </p>
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenChange(false);
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="accent"
          size="sm"
          disabled={!canSubmit}
          onClick={() => {
            void submit();
          }}
        >
          {isPending ? 'Creating…' : 'Create habit'}
        </Button>
      </div>
    </>
  );
}

/**
 * The create dialog. The stateful body is a child that mounts fresh on open so the draft
 * resets without a setState-in-effect — the established pattern in the code module's dialogs.
 */
export function NewHabitDialog({ open, onOpenChange, onCreate }: NewHabitDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="lg"
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      <NewHabitForm onOpenChange={onOpenChange} onCreate={onCreate} />
    </FormDialog>
  );
}
