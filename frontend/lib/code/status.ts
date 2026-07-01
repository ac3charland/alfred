import type { CodeStory } from '@/lib/types';

/**
 * The status fields a code story carries: its `factory_state` (which swimlane / Backlog status
 * it sits in) plus the two companions that move with it — `lane` and `blocked_reason`.
 */
export type CodeStoryStatus = Pick<CodeStory, 'factory_state' | 'lane' | 'blocked_reason'>;

/**
 * Project a code story down to just its STATUS fields — the single source of truth for what the
 * navigation refetch (ALF-69) reconciles onto a story already in the store. Kept dependency-free
 * (a type-only import) so it stands apart from the client store: pure, unit-testable, and the one
 * place that defines "a ticket's status" for the pull-refresh path.
 */
export function codeStoryStatusPatch(story: CodeStory): CodeStoryStatus {
  return {
    factory_state: story.factory_state,
    lane: story.lane,
    blocked_reason: story.blocked_reason,
  };
}
