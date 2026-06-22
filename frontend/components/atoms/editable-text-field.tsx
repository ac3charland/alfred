'use client';

import type { ReactNode } from 'react';

import { InlineEditField } from '@/components/atoms/inline-edit-field';
import { useInlineEdit } from '@/lib/hooks/use-inline-edit';

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
  children?: ReactNode;
}

/**
 * A click-to-edit text field: a display button that swaps to the shared `InlineEditField` on
 * click, wired to the `useInlineEdit` save semantics (Enter / confirm saves, Escape / outside
 * click cancels, no-op on empty/unchanged, rollback on throw). The `children` slot keeps each
 * call site's own display layout (a title element, a pencil affordance, etc.).
 */
export function EditableTextField({
  value,
  onSave,
  label,
  inputClassName,
  selectAllOnEdit,
  children,
}: EditableTextFieldProperties) {
  const { isEditing, begin, cancel, save, draft, setDraft } = useInlineEdit(value, onSave);
  const confirmLabel = `Confirm ${label.replace(/^Edit /, '')}`;

  // exactOptionalPropertyTypes: only forward inputClassName when defined.
  const inputClassProperty = inputClassName === undefined ? {} : { inputClassName };

  if (isEditing) {
    return (
      <InlineEditField
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          void save();
        }}
        onCancel={cancel}
        confirmLabel={confirmLabel}
        inputLabel={label}
        requireValue={false}
        selectAllOnFocus={selectAllOnEdit ?? true}
        className="flex-1"
        {...inputClassProperty}
      />
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
