'use client';

import * as React from 'react';

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
  /** Called after a successful capture (e.g. to collapse the inline form). */
  onCapture?: () => void;
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
}: CaptureBoxProperties) {
  const [value, setValue] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>();
  const { addTask } = useTaskActions();
  const textareaReference = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (event_?: React.SyntheticEvent) => {
    event_?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isPending) return;

    setIsPending(true);
    setErrorMessage(undefined);

    try {
      // The store inserts an optimistic node immediately and reconciles with the
      // saved row; on failure it rolls back and re-throws so we can surface the error.
      await addTask({ text: trimmed, folderId, parentId });
      setValue('');
      onCapture?.();
    } catch {
      setErrorMessage('Failed to save. Try again.');
    } finally {
      setIsPending(false);
    }
  };

  const handleKeyDown = (event_: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event_.key === 'Enter' && !event_.shiftKey) {
      event_.preventDefault();
      void handleSubmit();
    }
  };

  const handleCompactKeyDown = (event_: React.KeyboardEvent<HTMLInputElement>) => {
    if (event_.key === 'Enter') {
      event_.preventDefault();
      void handleSubmit();
    }

    if (event_.key === 'Escape') {
      setValue('');
      onCapture?.();
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
        <input
          type="text"
          value={value}
          onChange={(event_) => {
            setValue(event_.target.value);
          }}
          onKeyDown={handleCompactKeyDown}
          placeholder="Add subtask…"
          // autoFocus intentionally omitted — jsx-a11y/no-autofocus
          // The compact box is shown inline; focus is managed by the parent toggle.
          className={cn(
            'flex-1 rounded-sm border border-border bg-input px-3 py-1.5 text-sm text-foreground',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          disabled={isPending}
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={isPending || !value.trim()}
          className="shrink-0 text-accent-teal hover:bg-accent-teal/10 hover:text-accent-teal"
        >
          {isPending ? '…' : 'Add'}
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
          'rounded-2xl border border-border bg-surface',
          'transition-[box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none',
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
            'w-full resize-none rounded-2xl bg-transparent px-4 pt-4 pb-12',
            'text-base text-foreground',
            'focus:outline-none',
            'placeholder:text-muted-foreground',
            'disabled:opacity-50',
          )}
          disabled={isPending}
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
            disabled={isPending || !value.trim()}
            className="bg-accent-teal text-background hover:bg-accent-teal/90 disabled:opacity-40"
          >
            {isPending ? '…' : 'Capture'}
          </Button>
        </div>
      </div>
    </form>
  );
}
