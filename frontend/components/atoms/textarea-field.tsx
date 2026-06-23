'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';

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
  /** Disables both action buttons while a save is in flight. */
  isPending?: boolean;
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
  isPending = false,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  variant = 'default',
  'aria-label': ariaLabel,
}: TextareaFieldProperties) {
  const isWarning = variant === 'warning';
  const textareaId = React.useId();

  const textarea = (
    <textarea
      id={label === undefined ? undefined : textareaId}
      aria-label={ariaLabel}
      value={value}
      onChange={(event_) => {
        onChange(event_.target.value);
      }}
      onKeyDown={(event_) => {
        if (event_.key === 'Escape') onEscape?.();
      }}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
    />
  );

  const cancelButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={onCancel}
      className="text-muted-foreground"
    >
      {cancelLabel}
    </Button>
  );

  if (isWarning) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
        {label !== undefined && (
          <label htmlFor={textareaId} className="text-xs text-muted-foreground">
            {label}
          </label>
        )}
        {textarea}
        <div className="flex justify-end gap-2">
          {cancelButton}
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              void onSave();
            }}
            className="bg-amber-500 text-background hover:bg-amber-500/90"
          >
            {saveLabel}
          </Button>
        </div>
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
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            void onSave();
          }}
          className="text-accent-teal hover:bg-accent-teal/10"
        >
          {saveLabel}
        </Button>
        {cancelButton}
      </div>
    </div>
  );
}
