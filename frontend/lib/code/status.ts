import type { CodeStory } from '@/lib/types';

/**
 * The status fields a code story carries: its `factory_state` (which swimlane / Backlog status
 * it sits in) plus the companions that move with it — `lane`, `blocked_reason`, `blocked_from`
 * (the swimlane a blocked story keeps its card in, so a story blocked in another tab lands in the
 * right lane on refetch rather than snapping to the fallback), `requires_refinement` (whether
 * it still needs a spec, which the detail modal's toggle reads back), and the spec snapshot
 * (`spec_path` / `spec_sha` / `spec_markdown`).
 *
 * The spec columns belong here because a state is not self-describing without them: `ready_for_dev`
 * means two different things depending on whether a spec was ever committed, and the development
 * launch reads `spec_path` — not the lane — to decide between the spec-reading and the
 * skip-refinement prompt (ALF-317). The Worker records the path in the SAME write that moves a
 * merged refinement to `ready_for_dev`, so a projection that took the lane and left the path
 * behind landed a self-contradicting row. They are safe to carry for the same reason `title` and
 * `priority` are not: nothing in the app writes them locally, so there is no edit in flight to
 * clobber.
 */
export type CodeStoryStatus = Pick<
  CodeStory,
  | 'factory_state'
  | 'lane'
  | 'blocked_reason'
  | 'blocked_from'
  | 'requires_refinement'
  | 'spec_path'
  | 'spec_sha'
  | 'spec_markdown'
>;

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
    blocked_from: story.blocked_from,
    requires_refinement: story.requires_refinement,
    spec_path: story.spec_path,
    spec_sha: story.spec_sha,
    spec_markdown: story.spec_markdown,
  };
}
