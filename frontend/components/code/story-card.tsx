'use client';

import { ClickableCard } from '@/components/atoms/clickable-card';
import { LaunchButton } from '@/components/atoms/launch-button';
import { type LaunchPhase, launchPhaseFor } from '@/lib/code/launch';
import { isEscapeState } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

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
   * to the store's `openClaudeSession` by the board; the detail modal passes the same handler.
   * Optional so the card renders standalone (the launch button then no-ops).
   */
  onOpenSession?: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

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
  const canLaunch = launchPhaseFor(story.factory_state) !== undefined;

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
      <ClickableCard
        onClick={() => onOpen?.(story)}
        data-factory-state={story.factory_state ?? undefined}
        aria-label={`Open ${story.ref ?? ''} ${story.title ?? ''}`}
        className="px-3 py-2"
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
      </ClickableCard>
      {canLaunch ? (
        <div className="px-3 pb-2">
          <LaunchButton story={story} onOpenSession={onOpenSession} variant="chip" />
        </div>
      ) : null}
    </div>
  );
}
