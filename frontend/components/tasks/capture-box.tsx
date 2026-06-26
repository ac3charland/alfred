'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { TextField } from '@/components/atoms/text-field';
import { Textarea } from '@/components/atoms/textarea';
import { ALFRED_CAPTURE_FOCUS_EVENT } from '@/components/tasks/alfred-link';
import { useTaskActions } from '@/lib/stores/tasks-store';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

import { captureGhostClass, captureSurfaceClass, captureTextareaClass } from './capture-box.styles';

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
  // Has the user typed during the current focus session? The serif prompt is a resting hint:
  // it shows only while the box is empty AND the user has not yet engaged, so it does NOT pop
  // back up after a capture clears the box (still focused) — only once focus leaves the box.
  const [engaged, setEngaged] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>();
  // Transient "ghosts" of just-captured text that fade+slide right out of the box. An array so
  // rapid captures each get their own flourish; each carries a unique id (a monotonic counter)
  // so its own animationend removes exactly itself.
  const [ghosts, setGhosts] = React.useState<{ id: number; text: string }[]>([]);
  const ghostIdReference = React.useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();
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

    // Send the captured thought off with a fade+slide-right flourish (full mode only). Gated on
    // reduced motion: the ghost is removed on animationend, which never fires when the animation
    // is disabled — so under reduced motion we simply skip it rather than strand it on screen.
    if (!compact && !prefersReducedMotion) {
      const id = (ghostIdReference.current += 1);
      setGhosts((current) => [...current, { id, text: trimmed }]);
    }

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

  const handleGhostAnimationEnd = (id: number) => {
    setGhosts((current) => current.filter((ghost) => ghost.id !== id));
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
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setValue('');
            onDismiss?.();
          }
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
      onBlur={(event_) => {
        // Reset only when focus leaves the whole capture (not when it moves to the Capture
        // button), so the prompt stays hidden through a button-click capture too.
        if (!event_.currentTarget.contains(event_.relatedTarget)) setEngaged(false);
      }}
      className="relative"
    >
      <div className={captureSurfaceClass}>
        {/* Serif prompt — a resting hint shown only while empty and not yet engaged */}
        {!value && !engaged && (
          <p
            className="pointer-events-none absolute left-4 top-4 font-serif text-lg text-muted-foreground/60 select-none"
            aria-hidden
          >
            What&rsquo;s on your mind?
          </p>
        )}
        <Textarea
          unstyled
          ref={textareaReference}
          value={value}
          onChange={(event_) => {
            const next = event_.target.value;
            setValue(next);
            // Once the user has typed something, stay engaged for the rest of this focus
            // session so the prompt doesn't flicker back after the box is cleared on capture.
            if (next !== '') setEngaged(true);
          }}
          onKeyDown={handleKeyDown}
          rows={3}
          aria-label="Capture box"
          className={captureTextareaClass}
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
            variant="accent"
            aria-label="Capture"
            disabled={!value.trim()}
            className="disabled:opacity-40"
          >
            {isSaving ? <Spinner label="Saving" /> : 'Capture'}
          </Button>
        </div>
      </div>
      {/* Capture flourish: each ghost fades+slides right, then removes itself on animationend. */}
      {ghosts.map((ghost) => (
        <span
          key={ghost.id}
          data-testid="capture-ghost"
          aria-hidden
          className={captureGhostClass}
          onAnimationEnd={() => {
            handleGhostAnimationEnd(ghost.id);
          }}
        >
          {ghost.text}
        </span>
      ))}
    </form>
  );
}
