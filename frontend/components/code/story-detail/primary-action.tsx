'use client';

import { LaunchButton } from '@/components/atoms/launch-button';
import { type LaunchPhase, launchPhasesFor } from '@/lib/code/launch';
import type { CodeStory } from '@/lib/types';

interface PrimaryActionProperties {
  story: CodeStory;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/**
 * The "Open Claude Code" launch actions in the story-detail modal header — the `solid`
 * presentation of the shared {@link LaunchButton}, one per phase the state offers (mapping over
 * `launchPhasesFor`). In `needs_refinement` this renders "Refine in Claude Code" (solid accent)
 * followed by the subordinate "Skip to Development" (outline); in `ready_for_dev`, just
 * "Implement in Claude Code". Renders nothing outside the launch-eligible states.
 */
export function PrimaryAction({ story, onOpenSession }: PrimaryActionProperties) {
  const phases = launchPhasesFor(story.factory_state);
  if (phases.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {phases.map((phase) => (
        <LaunchButton
          key={phase}
          story={story}
          phase={phase}
          onOpenSession={onOpenSession}
          variant="solid"
        />
      ))}
    </div>
  );
}
