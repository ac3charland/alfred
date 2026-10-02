import type { CodeStory } from '@/lib/types';

/**
 * The status fields a code story carries: its `factory_state` (which swimlane / Backlog status
 * it sits in) plus the companions that move with it — `lane`, `blocked_reason`, `blocked_from`
 * (the swimlane a blocked story keeps its card in, so a story blocked in another tab lands in the
 * right lane on refetch rather than snapping to the fallback), `requires_refinement` (whether
 * it still needs a spec, which the detail modal's toggle reads back), and the spec and PR columns
 * the webhook Worker writes in the same breath as a state move (a refinement merge lands
 * `ready_for_dev` WITH its `spec_path`; an implementation PR opening lands `ready_for_review` WITH
 * its `implementation_pr_url`). A state without its spec reads as spec-less, and the Implement
 * launch then opens the skip-refinement prompt (ALF-317).
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
  | 'refinement_pr_url'
  | 'implementation_pr_url'
>;

/**
 * Project a code story down to just its STATUS fields — the single source of truth for what the
 * navigation refetch (ALF-69) reconciles onto a story already in the store. It leaves out what
 * this tab edits itself (title, notes, priority), so a refetch never clobbers an edit in flight;
 * every field it carries is written only by a state transition or the Worker. Kept
 * dependency-free (a type-only import) so it stands apart from the client store: pure,
 * unit-testable, and the one place that defines "a ticket's status" for the pull-refresh path.
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
    refinement_pr_url: story.refinement_pr_url,
    implementation_pr_url: story.implementation_pr_url,
  };
}
