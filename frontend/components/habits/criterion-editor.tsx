'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { OptionButton } from '@/components/atoms/option-button';
import { TextField } from '@/components/atoms/text-field';
import { minutesToTime, timeToMinutes } from '@/components/habits/habit-format';
import type { Comparator, CriterionKind, HabitCriterion } from '@/lib/habits';

/** A criterion without its key — the key is minted (and then frozen) by the form that owns it. */
export type CriterionShape =
  | { kind: 'boolean'; label: string }
  | { kind: 'time' | 'count' | 'duration'; label: string; target: number; comparator: Comparator };

/** What each kind is called, and the one-line example that teaches it. */
export const KIND_OPTIONS: readonly { kind: CriterionKind; label: string; hint: string }[] = [
  { kind: 'boolean', label: 'Yes / no', hint: 'got outside' },
  { kind: 'time', label: 'A time', hint: 'up by 06:15' },
  { kind: 'count', label: 'A count', hint: '3 glasses' },
  { kind: 'duration', label: 'A duration', hint: '20 minutes' },
];

/** How a comparator reads for each kind — "no later than" only makes sense about a clock. */
const COMPARATOR_WORDS: Record<CriterionKind, Record<Comparator, string>> = {
  boolean: { lte: '', gte: '', eq: '' },
  time: { lte: 'No later than', gte: 'No earlier than', eq: 'Exactly at' },
  count: { lte: 'At most', gte: 'At least', eq: 'Exactly' },
  duration: { lte: 'At most', gte: 'At least', eq: 'Exactly' },
};

/** The comparator a kind starts on: a time is a deadline, a count or duration is a floor. */
const DEFAULT_COMPARATOR: Record<CriterionKind, Comparator> = {
  boolean: 'gte',
  time: 'lte',
  count: 'gte',
  duration: 'gte',
};

const COMPARATORS: readonly Comparator[] = ['lte', 'gte', 'eq'];

interface CriterionEditorProperties {
  kind: CriterionKind;
  /** Present when editing an existing criterion — the fields open prefilled. */
  initial?: HabitCriterion;
  onSave: (shape: CriterionShape) => void;
  /** Present only on the edit path, so a criterion can be taken back out of the sentence. */
  onRemove?: () => void;
  onCancel: () => void;
}

/**
 * The second step of the create sentence's `+`, and the whole of the edit path: one popover
 * carrying ONLY the chosen kind's fields.
 *
 * Adding a criterion and editing one are the same surface with different initial values, so
 * this is built once and mounted from both — an edit-only copy beside it would drift.
 */
export function CriterionEditor({
  kind,
  initial,
  onSave,
  onRemove,
  onCancel,
}: CriterionEditorProperties) {
  const measured = kind !== 'boolean';
  const [label, setLabel] = React.useState(initial?.label ?? '');
  const [comparator, setComparator] = React.useState<Comparator>(
    initial !== undefined && initial.kind !== 'boolean'
      ? initial.comparator
      : DEFAULT_COMPARATOR[kind],
  );
  const initialTarget =
    initial !== undefined && initial.kind !== 'boolean' ? initial.target : undefined;
  const [target, setTarget] = React.useState(
    initialTarget === undefined
      ? ''
      : kind === 'time'
        ? minutesToTime(initialTarget)
        : String(initialTarget),
  );

  const parsedTarget = kind === 'time' ? timeToMinutes(target) : Number(target);
  const targetValid =
    !measured ||
    (target.trim() !== '' && parsedTarget !== undefined && !Number.isNaN(parsedTarget));
  const canSave = label.trim() !== '' && targetValid;

  const save = () => {
    if (!canSave) return;
    onSave(
      measured
        ? {
            kind,
            label: label.trim(),
            target: Number(parsedTarget),
            comparator,
          }
        : { kind: 'boolean', label: label.trim() },
    );
  };

  const kindLabel = KIND_OPTIONS.find((option) => option.kind === kind)?.label ?? '';
  const fieldId = React.useId();
  const labelRef = React.useRef<HTMLInputElement>(null);

  // The popover opens on top of the sentence, so focus moves to the first thing to fill in.
  React.useEffect(() => {
    labelRef.current?.focus();
  }, []);

  return (
    <div className="flex w-[250px] flex-col gap-2 p-2">
      <p className="text-[13px] font-semibold text-foreground">{kindLabel}</p>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <label htmlFor={`${fieldId}-label`}>Label</label>
        <TextField
          id={`${fieldId}-label`}
          ref={labelRef}
          value={label}
          onChange={(event_) => {
            setLabel(event_.target.value);
          }}
          onKeyDown={(event_) => {
            if (event_.key === 'Enter') save();
          }}
          placeholder="be up by"
          className="w-[140px] px-1.5 py-0.5 text-xs"
        />
      </div>

      {measured && (
        <>
          <div className="flex flex-col gap-0.5">
            {COMPARATORS.map((option) => (
              <OptionButton
                key={option}
                selected={comparator === option}
                className="px-2 py-1 text-xs"
                onClick={() => {
                  setComparator(option);
                }}
              >
                {COMPARATOR_WORDS[kind][option]}
              </OptionButton>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <label htmlFor={`${fieldId}-target`}>{COMPARATOR_WORDS[kind][comparator]}</label>
            <TextField
              id={`${fieldId}-target`}
              type={kind === 'time' ? 'time' : 'number'}
              value={target}
              onChange={(event_) => {
                setTarget(event_.target.value);
              }}
              onKeyDown={(event_) => {
                if (event_.key === 'Enter') save();
              }}
              className="w-[100px] px-1.5 py-0.5 font-mono text-xs"
            />
          </div>
        </>
      )}

      <div className="flex justify-end gap-1.5">
        {onRemove !== undefined && (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" disabled={!canSave} onClick={save}>
          Done
        </Button>
      </div>
    </div>
  );
}
