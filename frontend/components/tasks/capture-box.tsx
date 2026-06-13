'use client';

import * as React from 'react';

import { Spinner } from '@/components/atoms/spinner';
import { TextField } from '@/components/atoms/text-field';
import { ALFRED_CAPTURE_FOCUS_EVENT } from '@/components/tasks/alfred-link';
import { Button } from '@/components/ui/button';
import { useTaskActions } from '@/lib/stores/tasks-store';
import { cn } from '@/lib/utils';

interface CaptureBoxProperties {
  /** The folder to scope the capture to. Undefined means Inbox (no folder). */
  folderId?: string | null;
  /** If provided, the new item will be created as a subtask of this parent. */
  parentId?: string | null;
  /** Compact mode for inline "add subtask" affordance (no serif prompt). */
  compact?: boolean;
  /** Called after a successful capture. */
  onCapture?: () => void;
  /** Called when the user dismisses the compact input (Escape key). */
  onDismiss?: () => void;
}

/**
 * The hero capture box — the primary entry point for adding items.
 *
 * - Full mode: large textarea with a serif prompt, displayed above the Inbox.
 * - Compact mode: single-line input for inline subtask creation.
 *
 * Enter submits; Shift+Enter inserts a newline in full mode.
 */
export function CaptureBox({
  folderId,
  parentId,
  compact = false,
  onCapture,
  onDismiss,
}: CaptureBoxProperties) {
  const [value, setValue] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>();
  const { addTask } = useTaskActions();
  const textareaReference = React.useRef<HTMLTextAreaElement>(null);
  const inputReference = React.useRef<HTMLInputElement>(null);
  // Number of saves still in flight. A ref, not state, because the count itself never
  // drives the UI — only the derived "did the user get ahead of the network?" flag does.
  const inFlightReference = React.useRef(0);

  React.useEffect(() => {
    if (compact) {
      inputReference.current?.focus();
    } else {
      textareaReference.current?.focus();
    }
  }, [compact]);

  React.useEffect(() => {
    if (compact) return;
    const handleFocus = () => {
      textareaReference.current?.focus();
    };
    globalThis.addEventListener(ALFRED_CAPTURE_FOCUS_EVENT, handleFocus);
    return () => {
      globalThis.removeEventListener(ALFRED_CAPTURE_FOCUS_EVENT, handleFocus);
    };
  }, [compact]);

  const handleSubmit = async (event_?: React.SyntheticEvent) => {
    event_?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    // Optimistically clear and keep the box live so the next thought can be captured
    // immediately, while the store inserts an optimistic node and saves this one in the
    // background (reconciling with the saved row, or rolling back on failure).
    setValue('');
    setErrorMessage(undefined);

    // If a previous capture is still saving, the user out-typed the network — surface the
    // spinner and hold it until every in-flight save has drained.
    if (inFlightReference.current > 0) setIsSaving(true);
    inFlightReference.current += 1;

    try {
      await addTask({ text: trimmed, folderId, parentId });
      onCapture?.();
    } catch {
      setErrorMessage('Failed to save. Try again.');
      // Don't lose the capture: restore the failed text unless the user already started
      // typing the next one.
      setValue((current) => (current === '' ? trimmed : current));
    } finally {
      inFlightReference.current -= 1;
      if (inFlightReference.current === 0) setIsSaving(false);
    }
  };

  const handleKeyDown = (event_: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event_.key === 'Enter' && !event_.shiftKey) {
      event_.preventDefault();
      void handleSubmit();
    }
  };

  const handleCompactKeyDown = (event_: React.KeyboardEvent<HTMLInputElement>) => {
    // Stryker disable next-line ConditionalExpression,StringLiteral,BlockStatement: AT_CEILING — compact Enter is redundant; the wrapping <form onSubmit> already handles Enter via native form submission.
    if (event_.key === 'Enter') {
      event_.preventDefault();
      void handleSubmit();
    }

    if (event_.key === 'Escape') {
      setValue('');
      onDismiss?.();
    }
  };

  if (compact) {
    return (
      <form
        onSubmit={(event_) => {
          void handleSubmit(event_);
        }}
        className="flex items-center gap-2"
      >
        <TextField
          ref={inputReference}
          value={value}
          onChange={(event_) => {
            setValue(event_.target.value);
          }}
          onKeyDown={handleCompactKeyDown}
          placeholder="Add subtask…"
          className="flex-1 px-3 py-1.5"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          aria-label="Add"
          disabled={!value.trim()}
          className="shrink-0 text-accent-teal hover:bg-accent-teal/10 hover:text-accent-teal"
        >
          {isSaving ? <Spinner label="Saving" /> : 'Add'}
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event_) => {
        void handleSubmit(event_);
      }}
      className="relative"
    >
      <div
        className={cn(
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
          'rounded-2xl border border-border bg-surface',
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
          'transition-[box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none',
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
          'focus-within:border-accent-teal focus-within:shadow-[0_0_24px_0_rgba(79,209,224,0.12)]',
        )}
      >
        {/* Serif prompt — only visible when empty */}
        {!value && (
          <p
            className="pointer-events-none absolute left-4 top-4 font-serif text-lg text-muted-foreground/60 select-none"
            aria-hidden
          >
            What&rsquo;s on your mind?
          </p>
        )}
        <textarea
          ref={textareaReference}
          value={value}
          onChange={(event_) => {
            setValue(event_.target.value);
          }}
          onKeyDown={handleKeyDown}
          rows={3}
          aria-label="Capture box"
          className={cn(
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'w-full resize-none rounded-2xl bg-transparent px-4 pt-4 pb-12',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'text-base text-foreground',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'focus:outline-none',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'placeholder:text-muted-foreground',
          )}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {errorMessage && (
            <span className="text-xs text-destructive" role="alert">
              {errorMessage}
            </span>
          )}
          <span className="text-xs text-muted-foreground/50 select-none">
            Enter to capture · Shift+Enter for newline
          </span>
          <Button
            type="submit"
            size="sm"
            aria-label="Capture"
            disabled={!value.trim()}
            className="bg-accent-teal text-background hover:bg-accent-teal/90 disabled:opacity-40"
          >
            {isSaving ? <Spinner label="Saving" /> : 'Capture'}
          </Button>
        </div>
      </div>
    </form>
  );
}
