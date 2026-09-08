import { storyKindOf } from '@/lib/code/story-kind';
import type { CodeFactoryState, CodeStory } from '@/lib/types';

/**
 * The two lanes a story occupies while a spec is being written for it: waiting for one, and
 * having one written. Everything downstream of `ready_for_dev` is building, not refining.
 */
export const REFINEMENT_STATES = [
  'needs_refinement',
  'in_refinement',
] as const satisfies readonly CodeFactoryState[];

/** Is this one of the two spec-writing lanes? `null` (the view's nullable state) is not. */
export function isRefinementState(state: CodeFactoryState | null): boolean {
  // Widen the tuple for the lookup: `REFINEMENT_STATES` is a two-element literal type, so
  // `includes` would only accept one of those two literals as its argument.
  const lanes: readonly (CodeFactoryState | null)[] = REFINEMENT_STATES;
  return lanes.includes(state);
}

/**
 * Can this story be refined at all? False for a spike and a bug (ALF-215): neither is work you
 * spec before doing — a spike's deliverable IS the investigation, and a bug's shape only shows
 * up once it's reproduced — so both run in one session with no spec phase in front of it.
 *
 * The kind comes from the TITLE (`storyKindOf`), so this answer follows a rename with no write.
 */
export function canBeRefined(story: Pick<CodeStory, 'title'>): boolean {
  return storyKindOf(story) === 'story';
}

/**
 * May a manual move (the detail modal's status menu, a drag onto a swimlane) put this story in
 * `state`? Everything is allowed except parking a bug or a spike in a refinement lane, which
 * would offer a phase that kind never runs.
 */
export function canMoveToState(story: Pick<CodeStory, 'title'>, state: CodeFactoryState): boolean {
  return !isRefinementState(state) || canBeRefined(story);
}

/**
 * The refinement mark a story is CREATED with: whatever the author asked for, unless the title
 * makes it a bug or a spike — in which case it is false whatever the caller passed, and the
 * story is minted straight into Ready for Dev. Every creation path funnels through this, so the
 * board's New Story dialog and the gate that admits an inbox item agree without duplicating it.
 */
export function requiresRefinementFor(title: string, requested: boolean): boolean {
  return requested && canBeRefined({ title });
}

/** The state + mark a rename must write, or `null` when the story stays exactly where it is. */
export interface RenameStateChange {
  factory_state: CodeFactoryState;
  requires_refinement: boolean;
}

/**
 * What a RENAME does to a story's lane, given that the kind is derived from the title: crossing
 * the kind boundary can leave a story in a lane its new kind can't occupy, so the rename moves it.
 *
 * | Rename                    | Current lane        | Result                            |
 * | ------------------------- | ------------------- | --------------------------------- |
 * | story → `Bug:` / `Spike:` | a refinement lane   | → `ready_for_dev`, mark cleared    |
 * | `Bug:` / `Spike:` → story | `ready_for_dev`     | → `needs_refinement`, mark set     |
 * | anything else             | —                   | stays put                          |
 *
 * Only the two lanes that CONTRADICT the new kind move. A bug renamed back into a story
 * mid-build has already earned its place — dragging it back to Needs Refinement would undo work
 * in flight — and a story already carrying a committed `spec_path` is never rewound, since the
 * spec exists whatever the title now says (the same guard `refinementMarkTarget` applies).
 */
export function renameStateChange(
  story: Pick<CodeStory, 'title' | 'factory_state' | 'spec_path'>,
  nextTitle: string,
): RenameStateChange | null {
  const wasRefinable = canBeRefined(story);
  const isRefinable = canBeRefined({ title: nextTitle });
  if (wasRefinable === isRefinable) return null;
  if (!isRefinable) {
    return isRefinementState(story.factory_state)
      ? { factory_state: 'ready_for_dev', requires_refinement: false }
      : null;
  }
  return story.factory_state === 'ready_for_dev' && story.spec_path === null
    ? { factory_state: 'needs_refinement', requires_refinement: true }
    : null;
}
