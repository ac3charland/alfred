'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { TextField } from '@/components/atoms/text-field';
import { cn } from '@/lib/utils';

interface InlineEditFieldProperties {
  /** Controlled input value. */
  value: string;
  onChange: (value: string) => void;
  /** Commit the value (Enter, or the confirm check). */
  onSubmit: () => void;
  /** Dismiss the editor (Escape, or a pointerdown outside the field). */
  onCancel: () => void;
  /** aria-label for the confirm button — e.g. "Save folder", "Confirm title". */
  confirmLabel: string;
  /** aria-label for the input; omit to label it via `placeholder` alone. */
  inputLabel?: string;
  placeholder?: string;
  /** Disable the confirm button + ignore Enter while the trimmed value is empty (default true). */
  requireValue?: boolean;
  /** Select the existing text when the field is focused on mount (default false). */
  selectAllOnFocus?: boolean;
  /**
   * Render the wrapping `<form>` with `display: contents` (no box of its own) so the input +
   * confirm flow directly into the parent's layout columns. Used by the task row, whose title
   * lives in a grid template and needs the editor to occupy the same column as the static title.
   */
  dissolveIntoGrid?: boolean;
  /** Classes for the wrapping `<form>`. */
  className?: string;
  /** Classes for the `<input>`. */
  inputClassName?: string;
  /** Classes for the confirm button. */
  confirmClassName?: string;
}

/**
 * The shared inline text editor: a focused single-line input with a teal "confirm" check, used
 * wherever the app edits a name in place — folder create/rename and the task-row / epic title
 * editors (via `EditableTextField` / `useInlineEdit`). It owns the cross-cutting editor behavior
 * so call sites don't re-implement it: autofocus on mount, Enter (or the check) commits via
 * `onSubmit`, Escape or a pointerdown OUTSIDE the field dismisses via `onCancel`. The dismiss
 * listens on a document `pointerdown` (not blur) so it survives Radix restoring focus to the
 * trigger when the editor is opened from a dropdown menu.
 */
export function InlineEditField({
  value,
  onChange,
  onSubmit,
  onCancel,
  confirmLabel,
  inputLabel,
  placeholder,
  requireValue = true,
  selectAllOnFocus = false,
  dissolveIntoGrid = false,
  className,
  inputClassName,
  confirmClassName,
}: InlineEditFieldProperties) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  // Focus the input on mount without the autoFocus prop (jsx-a11y/no-autofocus).
  React.useEffect(() => {
    inputRef.current?.focus();
    if (selectAllOnFocus) inputRef.current?.select();
  }, [selectAllOnFocus]);

  // Dismiss when the user interacts outside the field. pointerdown (not blur) fires before focus
  // moves, so an editor opened from a Radix menu isn't false-cancelled when Radix restores focus
  // to the trigger on close — and tabbing out keeps the editor open (Escape / click-away cancel).
  React.useEffect(() => {
    const handlePointerDown = (event_: PointerEvent) => {
      if (formRef.current && !formRef.current.contains(event_.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onCancel]);

  const isEmpty = value.trim() === '';

  return (
    <form
      ref={formRef}
      onSubmit={(event_) => {
        event_.preventDefault();
        if (requireValue && isEmpty) return;
        onSubmit();
      }}
      className={cn(dissolveIntoGrid ? 'contents' : 'flex min-w-0 items-center gap-2', className)}
    >
      <TextField
        ref={inputRef}
        value={value}
        onChange={(event_) => {
          onChange(event_.target.value);
        }}
        onKeyDown={(event_) => {
          if (event_.key === 'Escape') onCancel();
        }}
        aria-label={inputLabel}
        placeholder={placeholder}
        className={cn('flex-1 min-w-0', inputClassName)}
      />
      <CheckboxButton
        type="submit"
        aria-label={confirmLabel}
        disabled={requireValue && isEmpty}
        className={cn(
          'h-6 w-6 border-accent-teal bg-accent-teal text-background',
          confirmClassName,
        )}
      >
        <Check size={12} strokeWidth={3} />
      </CheckboxButton>
    </form>
  );
}
