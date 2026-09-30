'use client';

import { LaunchButton } from '@/components/atoms/launch-button';
import { StatusMenu, type StoryTransitions } from '@/components/code/story-detail/manual-controls';
import { MoreActionsMenu } from '@/components/code/story-detail/more-actions-menu';
import { PriorityMenu } from '@/components/code/story-detail/priority-menu';
import { type LaunchPhase, launchPhasesFor } from '@/lib/code/launch';
import type { CodeStory } from '@/lib/types';

/**
 * The phone sheet's pinned bottom bar, where a thumb reaches: the primary launch (short label,
 * taking the room the other controls leave and truncating first), the status menu, an icon-only
 * Priority menu, and ⋯ for the rarer actions. Where the story offers no launch, the rest sit
 * left-aligned. A story's secondary launch (Skip to dev) is in ⋯, not here.
 *
 * It is the sheet's *resting* footer content: an open editor takes the footer and the bar steps
 * aside until it closes. Carries the bottom safe-area inset, so nothing sits under a home
 * indicator.
 */
export function ActionBar({
  story,
  transitions,
  onBlock,
  onOpenSession,
}: {
  story: CodeStory;
  transitions: StoryTransitions;
  onBlock: () => void;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}) {
  const primary = launchPhasesFor(story)[0];

  return (
    <div
      data-action-bar=""
      className="flex items-center gap-2 border-t border-border px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5"
    >
      {primary === undefined ? null : (
        <LaunchButton
          story={story}
          phase={primary}
          onOpenSession={onOpenSession}
          variant="solid"
          compact
          className="flex-1"
        />
      )}
      <StatusMenu
        story={story}
        state={story.factory_state}
        disabled={transitions.pending}
        onPick={transitions.pickStatus}
        className="shrink-0"
      />
      <PriorityMenu story={story} />
      <MoreActionsMenu
        story={story}
        transitions={transitions}
        onBlock={onBlock}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
