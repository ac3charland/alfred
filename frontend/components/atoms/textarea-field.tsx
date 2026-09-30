'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/atoms/button';
import { useSheetFooterClaim } from '@/components/atoms/dialog';
import { isSaveShortcut } from '@/lib/ui/save-shortcut';
import { cn } from '@/lib/utils';

interface TextareaFieldProperties {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  /** Called when Escape is pressed in the textarea (same semantics as Cancel). */
  onEscape?: () => void;
  /** Optional caption label shown above the textarea (the `warning` block-reason flow). */
  label?: string;
  placeholder?: string;
  /** Rows for the textarea (default 2). */
  rows?: number;
  /**
   * Optional native character cap. Given, the field can never produce a body the API and the DB
   * would reject; omitted, the attribute is absent and the textarea is uncapped as before.
   */
  maxLength?: number;
  /** Disables both action buttons while a save is in flight. */
  isPending?: boolean;
  /**
   * Gate the Save button (and the ⌘↵ chord) on the draft being worth saving — e.g. unchanged
   * from what is already stored. Distinct from `isPending`, which is about a write in flight and
   * also disables Cancel: an unsavable draft is still one the user may want to abandon.
   */
  canSave?: boolean;
  /** Save button text (default "Save"). */
  saveLabel?: string;
  /** Cancel button text (default "Cancel"). */
  cancelLabel?: string;
  /**
   * `default` — a bare textarea with left-aligned actions (a teal Save).
   * `warning` — an amber-bordered card with a caption label and right-aligned actions (an
   * amber Confirm), for the block-reason flow.
   */
  variant?: 'default' | 'warning';
  /** Accessible label for the textarea when no visible label is rendered. */
  'aria-label'?: string;
  /**
   * Grow the textarea to fit its content instead of scrolling inside it, with `rows` as the
   * floor. The surrounding container becomes the one scroller, so a long note is always readable
   * in full. Off by default (a fixed-`rows` box).
   */
  autoGrow?: boolean;
  /**
   * Draw Save / Cancel as a full-width bar in this element rather than under the textarea — a
   * `SheetDialog`'s footer (`useSheetFooterElement`), so the actions sit below the scrolling
   * body instead of over the text. `null` means the element isn't there yet: the actions wait
   * rather than flashing inline. Omitted, they render inline as always. While set, the field
   * also holds the sheet's footer, hiding the sheet's resting bar.
   */
  actionsTarget?: Element | null | undefined;
  /**
   * Focus the textarea when it mounts, with the caret at the end of its text — for an editor the
   * user just asked to open, where a second tap to reach the field (and raise a phone's keyboard)
   * would be a dead end. Off by default.
   */
  focusOnMount?: boolean;
}

/**
 * A textarea paired with Save / Cancel actions — the repeated inline editor used by the
 * epic notes (default) and the story block-reason (warning) blocks. The `warning` variant
 * adds the amber card chrome, a caption label, and an amber confirm button.
 */
export function TextareaField({
  value,
  onChange,
  onSave,
  onCancel,
  onEscape,
  label,
  placeholder,
  rows = 2,
  maxLength,
  isPending = false,
  canSave = true,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  variant = 'default',
  'aria-label': ariaLabel,
  autoGrow = false,
  actionsTarget,
  focusOnMount = false,
}: TextareaFieldProperties) {
  const isWarning = variant === 'warning';
  const textareaId = React.useId();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const inBar = actionsTarget !== undefined;

  useSheetFooterClaim(inBar);

  // Measure from `auto` so the box can shrink as well as grow. `scrollHeight` leaves the border
  // out and the box is `border-box`, so add it back (`offsetHeight − clientHeight`) or a sliver
  // of the last line would be left to scroll.
  React.useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!autoGrow || node === null) return;
    node.style.height = 'auto';
    node.style.height = `${String(node.scrollHeight + node.offsetHeight - node.clientHeight)}px`;
  }, [autoGrow, value]);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!focusOnMount || node === null) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [focusOnMount]);

  const textarea = (
    <textarea
      ref={textareaRef}
      id={label === undefined ? undefined : textareaId}
      aria-label={ariaLabel}
      value={value}
      onChange={(event_) => {
        onChange(event_.target.value);
      }}
      onKeyDown={(event_) => {
        if (event_.key === 'Escape') onEscape?.();
        // ⌘↵ / Ctrl+↵ commits without reaching for the Save button; preventDefault stops the
        // newline the chord would otherwise insert. A save already in flight swallows it, exactly
        // as the disabled buttons do.
        if (isSaveShortcut(event_) && !isPending && canSave) {
          event_.preventDefault();
          void onSave();
        }
      }}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      className={cn(
        'w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
        autoGrow && 'overflow-hidden',
      )}
    />
  );

  // In the bar, pressing a button must not pull focus off the textarea: on a phone that would
  // drop the keyboard, resize the sheet, and move the button out from under the finger before
  // the click lands.
  const keepFocus = inBar
    ? {
        onMouseDown: (event_: React.MouseEvent) => {
          event_.preventDefault();
        },
      }
    : {};

  const cancelButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={onCancel}
      className="text-muted-foreground"
      {...keepFocus}
    >
      {cancelLabel}
    </Button>
  );

  /** The action row: inline under the textarea, or a bar portalled into `actionsTarget`. */
  const renderActions = (buttons: React.ReactNode, inlineClassName: string) => {
    if (actionsTarget === undefined) return <div className={inlineClassName}>{buttons}</div>;
    if (actionsTarget === null) return null;
    return createPortal(
      <div
        className={cn(
          'flex gap-2 border-t border-border bg-surface px-4 py-2',
          isWarning && 'justify-end',
        )}
      >
        {buttons}
      </div>,
      actionsTarget,
    );
  };

  if (isWarning) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
        {label !== undefined && (
          <label htmlFor={textareaId} className="text-xs text-muted-foreground">
            {label}
          </label>
        )}
        {textarea}
        {renderActions(
          <>
            {cancelButton}
            <Button
              size="sm"
              disabled={isPending || !canSave}
              onClick={() => {
                void onSave();
              }}
              className="bg-amber-500 text-background hover:bg-amber-500/90"
              {...keepFocus}
            >
              {saveLabel}
            </Button>
          </>,
          'flex justify-end gap-2',
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {label !== undefined && (
        <label htmlFor={textareaId} className="text-xs text-muted-foreground">
          {label}
        </label>
      )}
      {textarea}
      {renderActions(
        <>
          <Button
            variant="ghostAccent"
            size="sm"
            disabled={isPending || !canSave}
            onClick={() => {
              void onSave();
            }}
            {...keepFocus}
          >
            {saveLabel}
          </Button>
          {cancelButton}
        </>,
        'flex gap-2',
      )}
    </div>
  );
}
