'use client';

import * as React from 'react';

export interface UseInlineEdit {
  isEditing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  /** Seed the draft from the current value and enter edit mode. */
  begin: () => void;
  /** Reset the draft to the current value and exit edit mode. */
  cancel: () => void;
  /**
   * Trim the draft and commit. Exits edit mode first (so an optimistic value shows
   * immediately); a no-op when the trimmed draft is empty or unchanged; on `onSave` throw,
   * rolls the draft back to the current value (the optimistic store handles the row rollback).
   */
  save: () => Promise<void>;
  /** Ref for the editing input — focused (and optionally selected) on entering edit mode. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Spreadable convenience props for the editing `<input>`. */
  inputProps: {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  };
}

interface UseInlineEditOptions {
  /** Select all text when entering edit mode (default true). */
  selectAllOnEdit?: boolean;
}

/**
 * The shared click-to-edit state machine: a draft string, an editing flag, and a `save`
 * that trims, exits first, no-ops on empty/unchanged, awaits `onSave`, and rolls the draft
 * back on throw. The five inline-title/notes editors across the app reimplemented this; they
 * now share it. The *edit-mode lifecycle* (what opens it, how it cancels, where the flag
 * lives) stays at the call site — task-row drives editing through the cross-row active-editor
 * store, board cancels on a document mousedown, folder-nav lives in a `<form>` — so callers
 * may ignore `isEditing` / `begin` / `cancel` and use only `draft` + `save` + `inputProps`.
 */
export function useInlineEdit(
  currentValue: string,
  onSave: (next: string) => Promise<void> | void,
  options?: UseInlineEditOptions,
): UseInlineEdit {
  const selectAllOnEdit = options?.selectAllOnEdit ?? true;
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(currentValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      if (selectAllOnEdit) inputRef.current?.select();
    }
  }, [isEditing, selectAllOnEdit]);

  const begin = React.useCallback(() => {
    setDraft(currentValue);
    setIsEditing(true);
  }, [currentValue]);

  const cancel = React.useCallback(() => {
    setIsEditing(false);
    setDraft(currentValue);
  }, [currentValue]);

  const save = React.useCallback(async () => {
    const next = draft.trim();
    setIsEditing(false);
    if (next === '' || next === currentValue) {
      setDraft(currentValue);
      return;
    }
    try {
      await onSave(next);
    } catch {
      // The optimistic store reverted the row; reset the draft for the next edit.
      setDraft(currentValue);
    }
  }, [draft, currentValue, onSave]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') void save();
      if (event.key === 'Escape') cancel();
    },
    [save, cancel],
  );

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);

  return {
    isEditing,
    draft,
    setDraft,
    begin,
    cancel,
    save,
    inputRef,
    inputProps: { value: draft, onChange: handleChange, onKeyDown: handleKeyDown },
  };
}
