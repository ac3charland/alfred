'use client';

import * as React from 'react';

import { Spinner } from '@/components/atoms/spinner';
import { isEscapeState } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Which launch button (if any) applies in a given factory state. */
type LaunchPhase = 'refinement' | 'implementation';

function launchPhaseFor(story: CodeStory): LaunchPhase | undefined {
  if (story.factory_state === 'needs_refinement') return 'refinement';
  if (story.factory_state === 'ready_for_dev') return 'implementation';
  return undefined;
}

export interface StoryCardProperties {
  /** The flattened code-story row to render. */
  story: CodeStory;
  /**
   * Invoked when the card body is activated (click / Enter / Space) — opens the detail modal.
   * Optional so the card renders standalone.
   */
  onOpen?: (story: CodeStory) => void;
  /**
   * The human launch: open a prefilled Claude Code tab for this story's phase. Wired
   * to the store's `openClaudeSession` by the board; the detail modal passes the same handler. The
   * card awaits it so the in-flight spinner reflects the real state write. Optional so the
   * card renders standalone (the launch button then no-ops).
   */
  onOpenSession?: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/** The button label + the in-flight (spinner) label for each launch phase. */
const LAUNCH_LABELS: Record<LaunchPhase, { idle: string; busy: string }> = {
  refinement: { idle: 'Refine in Claude Code', busy: 'Opening refinement' },
  implementation: { idle: 'Implement in Claude Code', busy: 'Opening implementation' },
};

/**
 * A single story on the board: a compact card showing its **ref** and **title**, plus
 * the **phase-appropriate "Open Claude Code" action** when one applies — *Refine* in
 * `needs_refinement`, *Implement* in `ready_for_dev`, hidden in every other state.
 *
 * The card body is an activatable control (opens the detail modal). A `blocked`/
 * `abandoned` story gets a distinct treatment (amber/red edge + a state tag) so it reads as
 * off the happy path even when surfaced via the escape filter.
 */
export function StoryCard({ story, onOpen, onOpenSession }: StoryCardProperties) {
  const escape = isEscapeState(story.factory_state);
  const blocked = story.factory_state === 'blocked';
  const phase = launchPhaseFor(story);
  // Local, transient UI state (data-flow skill): the launch's in-flight flag lives here, not
  // in the store — it's per-card and has no cross-row reach.
  const [launching, setLaunching] = React.useState(false);

  async function handleLaunch() {
    if (phase === undefined || onOpenSession === undefined) return;
    setLaunching(true);
    try {
      await onOpenSession(story, phase);
      // On success the store has moved the story out of this lane; the card unmounts, so we
      // don't clear the flag (avoids a setState-after-unmount). On failure we re-enable below.
    } catch {
      setLaunching(false);
    }
  }

  const labels = phase === undefined ? undefined : LAUNCH_LABELS[phase];

  return (
    <div
      className={cn(
        'group/card w-full rounded-lg border bg-surface transition-colors duration-100 motion-reduce:transition-none',
        'focus-within:ring-2 focus-within:ring-accent-blue focus-within:ring-offset-1 focus-within:ring-offset-background',
        escape
          ? blocked
            ? 'border-l-2 border-l-amber-500/80 border-border hover:border-amber-500'
            : 'border-l-2 border-l-destructive/70 border-border hover:border-destructive'
          : 'border-border hover:border-accent-teal/50',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(story)}
        data-factory-state={story.factory_state ?? undefined}
        aria-label={`Open ${story.ref ?? ''} ${story.title ?? ''}`}
        className="block w-full px-3 py-2 text-left focus:outline-none"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium text-accent-teal">{story.ref}</span>
          {escape ? (
            <span
              className={cn(
                'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide',
                blocked ? 'bg-amber-500/15 text-amber-400' : 'bg-destructive/15 text-destructive',
              )}
            >
              {blocked ? 'Blocked' : 'Abandoned'}
            </span>
          ) : null}
        </span>
        <span className="mt-1 line-clamp-2 block text-sm text-foreground">{story.title}</span>
      </button>
      {phase !== undefined && labels !== undefined ? (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => {
              void handleLaunch();
            }}
            disabled={launching}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-accent-teal/40 bg-accent-teal/10 px-2 py-1 text-xs font-medium text-accent-teal',
              'transition-colors duration-100 hover:bg-accent-teal/20 motion-reduce:transition-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
              'disabled:cursor-not-allowed disabled:opacity-70',
            )}
          >
            {launching ? <Spinner size={12} label={labels.busy} /> : null}
            {labels.idle}
          </button>
        </div>
      ) : null}
    </div>
  );
}
