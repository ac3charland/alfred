'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

import { useInlineEdit } from '@/lib/hooks/use-inline-edit';
import { cn } from '@/lib/utils';

interface EditableTextFieldProperties {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  /**
   * aria-label for the editing input (e.g. "Edit title"); the confirm button derives
   * "Confirm <noun>" from it (stripping a leading "Edit ").
   */
  label: string;
  /** Sizing / typography for the input (e.g. `text-lg font-semibold`, `flex-1`). */
  inputClassName?: string;
  /** Select all text when entering edit mode (default true). */
  selectAllOnEdit?: boolean;
  /** Display-mode content; defaults to the current value. */
  children?: React.ReactNode;
}

/**
 * A click-to-edit text field: a display button that swaps to an inline input on click, with
 * the shared save semantics (Enter / confirm saves, Escape / blur cancels, rollback on throw)
 * from `useInlineEdit`. The `children` slot keeps each call site's own display layout (a title
 * element, a pencil affordance, etc.). The confirm control is the teal-filled check box used
 * across the title editors.
 */
export function EditableTextField({
  value,
  onSave,
  label,
  inputClassName,
  selectAllOnEdit,
  children,
}: EditableTextFieldProperties) {
  const { isEditing, begin, cancel, save, inputRef, inputProps } = useInlineEdit(value, onSave, {
    selectAllOnEdit: selectAllOnEdit ?? true,
  });
  const confirmLabel = `Confirm ${label.replace(/^Edit /, '')}`;

  if (isEditing) {
    return (
      <div
        className="flex flex-1 items-center gap-2"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) cancel();
        }}
      >
        <input
          ref={inputRef}
          aria-label={label}
          type="text"
          {...inputProps}
          className={cn(
            'flex-1 rounded-sm border border-border bg-input px-2 py-1 text-sm text-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
            inputClassName,
          )}
        />
        <button
          type="button"
          aria-label={confirmLabel}
          onClick={() => {
            void save();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        >
          <Check size={12} className="text-background" strokeWidth={3} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      className="group/editable flex flex-1 items-center gap-2 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
    >
      {children ?? value}
    </button>
  );
}
