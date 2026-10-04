import type { CodeStory } from '@/lib/types';

/**
 * The status fields a code story carries: its `factory_state` (which swimlane / Backlog status
 * it sits in) plus the companions that move with it — `lane`, `blocked_reason`, `blocked_from`
 * (the swimlane a blocked story keeps its card in, so a story blocked in another tab lands in the
 * right lane on refetch rather than snapping to the fallback), `requires_refinement` (whether
 * it still needs a spec, which the detail modal's toggle reads back), the Worker-written spec and
 * PR columns (a merged refinement PR's `spec_path` lands with `ready_for_dev` — ALF-317), and
 * `code_updated_at` (the Done lane's recency order, ALF-81).
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
  | 'code_updated_at'
>;

/**
 * Project a code story down to just its STATUS fields — the single source of truth for what the
 * navigation refetch (ALF-69) reconciles onto a story already in the store. Kept dependency-free
 * (a type-only import) so it stands apart from the client store: pure, unit-testable, and the one
 * place that defines "a ticket's status" for the pull-refresh path.
 *
 * The refetch stands in for a realtime UPDATE the tab missed, so it carries every column that
 * UPDATE would have (`codeItemToStoryPatch`): a story moved into `ready_for_dev` without its
 * `spec_path` launches as a skip-refinement session (ALF-317). Left out are `priority`, which waits
 * out the pending priority writes (ALF-250), and the columns fixed at creation (`ref`,
 * `ref_number`, `code_created_at`); title and notes live on the item, not the sidecar.
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
    code_updated_at: story.code_updated_at,
  };
}
