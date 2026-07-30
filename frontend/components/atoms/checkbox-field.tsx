'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { FieldLabel } from '@/components/atoms/field-label';
import { cn } from '@/lib/utils';

interface CheckboxFieldProperties {
  /** The control's visible text, and — via `aria-labelledby` — its accessible name. */
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Greyed and inert, e.g. while a write is in flight. */
  disabled?: boolean;
  /** Optional line under the label explaining what the current setting does. */
  hint?: React.ReactNode;
  className?: string;
}

/**
 * A labelled checkbox — the `CheckboxButton` box paired with a `FieldLabel` and an optional hint
 * line beneath it, so a boolean setting reads like the form's other fields.
 *
 * The box is a `<button role="checkbox">` rather than an `<input type="checkbox">` because it
 * builds on the same `CheckboxButton` primitive the task rows use, keeping one box geometry and
 * focus ring across the app. A `<label htmlFor>` can't name a button (buttons aren't labelable),
 * so the association runs the other way: the label carries the id and the box points at it with
 * `aria-labelledby`, which leaves exactly one accessible name.
 */
export function CheckboxField({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  hint,
  className,
}: CheckboxFieldProperties) {
  const labelId = React.useId();

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <CheckboxButton
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => {
          onCheckedChange(!checked);
        }}
        className={cn(
          'mt-px h-4 w-4',
          checked ? 'border-accent-teal bg-accent-teal' : 'border-border',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-accent-teal',
        )}
      >
        {checked && <Check size={11} className="text-background" strokeWidth={3} />}
      </CheckboxButton>
      <div className="flex min-w-0 flex-col gap-0.5">
        <FieldLabel id={labelId} className="normal-case tracking-normal text-foreground">
          {label}
        </FieldLabel>
        {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
