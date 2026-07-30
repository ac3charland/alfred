import type { CodeFactoryState, CodeStory } from '@/lib/types';

/**
 * The factory state a refinement-mark change should land the story in — often the state it is
 * already in. Clearing the mark only fast-forwards a story still sitting at the front of the
 * lifecycle; re-setting it only undoes that fast-forward, and only while no spec exists.
 *
 * | Current state      | `spec_path` | mark → false      | mark → true          |
 * | ------------------ | ----------- | ----------------- | -------------------- |
 * | `needs_refinement` | —           | → `ready_for_dev` | unchanged            |
 * | `ready_for_dev`    | `null`      | unchanged         | → `needs_refinement` |
 * | `ready_for_dev`    | set         | unchanged         | unchanged            |
 * | anything else      | —           | unchanged         | unchanged            |
 *
 * A story that already has a committed `spec_path` is never rewound: the spec exists whatever the
 * flag now says, so sending it back to Needs Refinement would ask for a second one. And marking a
 * story mid-flight (say, in `ready_for_review`) is harmless — the judgement is recorded on the row
 * without yanking the card across the board.
 */
export function refinementMarkTarget(
  story: Pick<CodeStory, 'factory_state' | 'spec_path'>,
  requiresRefinement: boolean,
): CodeFactoryState {
  const state = story.factory_state;
  if (!requiresRefinement && state === 'needs_refinement') return 'ready_for_dev';
  if (requiresRefinement && state === 'ready_for_dev' && story.spec_path === null) {
    return 'needs_refinement';
  }
  // Every other combination leaves the story where it is. `factory_state` is nominally nullable
  // on the view row; a story with no state has nowhere to move either, so fall back to the front
  // of the lifecycle rather than inventing a hop.
  return state ?? 'needs_refinement';
}
