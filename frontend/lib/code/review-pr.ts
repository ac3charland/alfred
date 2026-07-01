import type { CodeStory } from '@/lib/types';

/**
 * The open PR a reviewer should look at for a story in a *review* state, or null.
 * `in_refinement` → the refinement (spec) PR; `ready_for_review` → the implementation PR.
 * Any other state (or a review state whose PR isn't recorded yet) returns null, so the card
 * renders no Review PR chip.
 */
export function reviewPrUrlFor(story: CodeStory): string | null {
  if (story.factory_state === 'in_refinement') return story.refinement_pr_url;
  if (story.factory_state === 'ready_for_review') return story.implementation_pr_url;
  return null;
}
