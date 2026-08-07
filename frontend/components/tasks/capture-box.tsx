'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Popover, PopoverAnchor } from '@/components/atoms/popover';
import { Spinner } from '@/components/atoms/spinner';
import { TextField } from '@/components/atoms/text-field';
import { Textarea } from '@/components/atoms/textarea';
import { ALFRED_CAPTURE_FOCUS_EVENT } from '@/components/tasks/alfred-link';
import { ProjectSuggestPopover } from '@/components/tasks/project-suggest-popover';
import { parseProjectPrefix as matchProjectPrefix } from '@/lib/code/project-prefix';
import {
  applyProjectSuggestion,
  parseSuggestTrigger,
  projectSuggestionDomId,
  rankProjectSuggestions,
} from '@/lib/code/project-suggestions';
import { useProjects } from '@/lib/stores/code-store';
import { useTaskActions } from '@/lib/stores/tasks-store';
import type { Project } from '@/lib/types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

import { captureGhostClass, captureSurfaceClass, captureTextareaClass } from './capture-box.styles';

/** The suggestion listbox's DOM id — the textarea's `aria-controls` target. */
const SUGGEST_LISTBOX_ID = 'capture-project-suggestions';

interface CaptureBoxProperties {
  /** The folder to scope the capture to. Undefined means Inbox (no folder). */
  folderId?: string | null;
  /** If provided, the new item will be created as a subtask of this parent. */
  parentId?: string | null;
  /** Compact mode for inline "add subtask" affordance (no serif prompt). */
  compact?: boolean;
  /** Compact-mode placeholder — a code parent's box reads "Add story…" (ALF-129). */
  placeholder?: string;
  /**
   * Opt-in project prefixing (Inbox capture box only). When true, a leading `:` opens an
   * anchored list of projects whose selection writes a `<KEY>: ` prefix into the box, AND a
   * recognized `<project name|key>:` prefix classifies the capture as Code, assigns that
   * project, and strips the prefix. One flag gates both halves, so the list can never appear
   * on a surface that wouldn't honour the prefix it inserts. Off (the default) for folder and
   * subtask capture boxes.
   */
  parseProjectPrefix?: boolean;
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
 * Enter submits; Shift+Enter inserts a newline in full mode. With `parseProjectPrefix` on, a
 * leading `:` opens the anchored project list, which claims ↑↓/↵/Tab/Esc until it closes.
 */
export function CaptureBox({
  folderId,
  parentId,
  compact = false,
  placeholder = 'Add subtask…',
  parseProjectPrefix = false,
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
  // The project list backs prefix parsing; read unconditionally (hook rules) but only consulted
  // when `parseProjectPrefix` is on. The shell seeds CodeProvider around the Tasks view (ALF-27).
  const projects = useProjects();
  const textareaReference = React.useRef<HTMLTextAreaElement>(null);
  const inputReference = React.useRef<HTMLInputElement>(null);
  // Number of saves still in flight. A ref, not state, because the count itself never
  // drives the UI — only the derived "did the user get ahead of the network?" flag does.
  const inFlightReference = React.useRef(0);
  // True while the compact "Add" button is being pressed. On touch devices a button doesn't
  // take focus on tap, so tapping "Add" blurs the input with a null relatedTarget — which the
  // form's onBlur would read as "focus left the box" and dismiss before the submit lands. The
  // button's onPointerDown fires before that blur, so this flag lets onBlur skip the dismiss.
  const pressingSubmitReference = React.useRef(false);
  // The suggestion list's own state: which row is active, and whether Escape has shut it for
  // this trigger session. Everything else about the list is derived from `value` below.
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);
  // Set when a selection rewrites the value, so the layout effect below knows to move the caret.
  const caretToEndReference = React.useRef(false);
  const surfaceReference = React.useRef<HTMLDivElement>(null);

  // The whole list is derived from the box's raw value — there is no "suggestion mode" to enter
  // or leave, so deleting back to `:` reopens it exactly as typing it forward does.
  const trigger = parseProjectPrefix && !compact ? parseSuggestTrigger(value) : null;
  const suggestions = trigger === null ? [] : rankProjectSuggestions(trigger.query, projects);
  const suggestOpen = trigger !== null && !dismissed && suggestions.length > 0;

  // Reset the active row whenever the query changes — the derive-during-render pattern (see
  // search-box.tsx), never a setState effect. A null query means the value stopped leading with
  // ':', which also re-arms a dismissal.
  const query = trigger?.query ?? null;
  const [lastQuery, setLastQuery] = React.useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
    if (query === null) setDismissed(false);
  }
  // Keep the active row in range as the list shrinks under the cursor.
  const clampedIndex = suggestions.length === 0 ? 0 : Math.min(activeIndex, suggestions.length - 1);
  const activeSuggestion = suggestOpen ? suggestions[clampedIndex] : undefined;

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
      // A recognized `<project>:` prefix (Inbox box only) classifies the capture as Code,
      // assigns the project, and strips the prefix; otherwise capture verbatim as today.
      const match = parseProjectPrefix ? matchProjectPrefix(trimmed, projects) : null;
      await (match
        ? addTask({
            text: trimmed,
            itemType: 'code',
            title: match.title,
            intendedProjectId: match.project.id,
          })
        : addTask({ text: trimmed, folderId, parentId }));
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

  /**
   * Commit a suggestion: rewrite the value to `<KEY>: <remainder>` and flag the caret move. The
   * list closes on its own — the new value no longer leads with ':', so the trigger is gone.
   */
  const applySuggestion = (project: Project) => {
    if (trigger === null) return;
    setValue(applyProjectSuggestion(trigger, project));
    setEngaged(true);
    caretToEndReference.current = true;
  };

  // Placing the caret inline with `setValue` is clobbered by the re-render, so do it on the beat
  // after the new value commits — before paint, so the caret never flashes at the wrong offset.
  React.useLayoutEffect(() => {
    if (!caretToEndReference.current) return;
    caretToEndReference.current = false;
    const textarea = textareaReference.current;
    if (textarea === null) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [value]);

  const handleKeyDown = (event_: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the project list is open it owns ↑↓/↵/Tab/Esc, so Enter completes the prefix
    // instead of capturing a half-typed `:alf`. Shift+Enter still inserts a newline.
    if (suggestOpen) {
      if (event_.key === 'ArrowDown') {
        event_.preventDefault();
        setActiveIndex(Math.min(clampedIndex + 1, suggestions.length - 1));
        return;
      }
      if (event_.key === 'ArrowUp') {
        event_.preventDefault();
        setActiveIndex(Math.max(clampedIndex - 1, 0));
        return;
      }
      if (event_.key === 'Escape') {
        event_.preventDefault();
        setDismissed(true);
        return;
      }
      if (
        activeSuggestion !== undefined &&
        !event_.shiftKey &&
        (event_.key === 'Enter' || event_.key === 'Tab')
      ) {
        event_.preventDefault();
        applySuggestion(activeSuggestion);
        return;
      }
    }

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
          // Skip the dismiss when the blur is caused by pressing "Add": on touch devices that
          // blur carries a null relatedTarget (the button never takes focus), so the
          // contains-check alone would wrongly tear the box down before the submit fires.
          if (pressingSubmitReference.current) return;
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
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          aria-label="Add"
          disabled={!value.trim()}
          onPointerDown={() => {
            pressingSubmitReference.current = true;
          }}
          onClick={() => {
            pressingSubmitReference.current = false;
          }}
          // A ≥44px tap target on mobile so a near-miss lands on "Add" and submits, rather than
          // falling just outside it and blurring the input (which tears the compact box down
          // before the submit fires). The button sits flush beside the flex-1 field, so this
          // enlarges its REAL box (min-h-11) — an invisible overlay would collide with the
          // field's focus ring. Back to the compact size at md+ where pointer devices don't need it.
          className="min-h-11 shrink-0 text-accent-teal hover:bg-accent-teal/10 hover:text-accent-teal md:min-h-0"
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
      <Popover
        open={suggestOpen}
        onOpenChange={(next) => {
          // Radix closes on Escape / an outside interaction; both mean "shut it for this
          // trigger session", which the value alone can't express.
          if (!next) setDismissed(true);
        }}
        modal={false}
      >
        <PopoverAnchor asChild>
          <div ref={surfaceReference} className={captureSurfaceClass}>
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
              // Suggestions turn the box into a combobox; without them it stays a plain textbox,
              // so the folder and subtask boxes are untouched.
              role={parseProjectPrefix ? 'combobox' : undefined}
              aria-autocomplete={parseProjectPrefix ? 'list' : undefined}
              aria-expanded={parseProjectPrefix ? suggestOpen : undefined}
              aria-controls={parseProjectPrefix ? SUGGEST_LISTBOX_ID : undefined}
              aria-activedescendant={
                activeSuggestion === undefined
                  ? undefined
                  : projectSuggestionDomId(activeSuggestion)
              }
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
        </PopoverAnchor>
        {suggestOpen && (
          <ProjectSuggestPopover
            suggestions={suggestions}
            projects={projects}
            activeIndex={clampedIndex}
            listboxId={SUGGEST_LISTBOX_ID}
            onSelect={applySuggestion}
            onHover={setActiveIndex}
            onClose={() => {
              setDismissed(true);
            }}
            anchorRef={surfaceReference}
          />
        )}
      </Popover>
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
