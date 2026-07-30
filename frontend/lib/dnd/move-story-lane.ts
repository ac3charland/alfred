/**
 * Pure logic for the drag-a-story-between-swimlanes interaction (see the dnd-kit skill).
 *
 * dnd-kit reports a drop only as `active.id` / `over.id`, so each swimlane registers as a
 * droppable whose id encodes both halves of "which lane": the state, and the epic whose row it
 * belongs to (every epic on the board renders its own six lanes, so the state alone would name
 * six lanes at once). This module turns that id plus the dragged story into the transition it
 * should trigger, or a no-op. Keeping it pure makes it unit-testable, since jsdom can't measure
 * layout to drive a real drag.
 */
import { HAPPY_PATH_STATES, type HappyPathState } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/** Marks a droppable id as a swimlane (vs a story card, which drags under its bare item id). */
export const LANE_DROP_PREFIX = '__lane__';
/** Separates the lane's state from its epic id. A state never contains it; a uuid never does either. */
const LANE_ID_SEPARATOR = '::';

/** The droppable id one epic's lane registers under. */
export function laneDropId(epicId: string, state: HappyPathState): string {
  return `${LANE_DROP_PREFIX}${state}${LANE_ID_SEPARATOR}${epicId}`;
}

/** Which lane `overId` names, or `null` when it isn't a lane at all. */
export function parseLaneDropId(
  overId: string | null,
): { epicId: string; state: HappyPathState } | null {
  if (!overId?.startsWith(LANE_DROP_PREFIX)) return null;
  const [rawState, epicId] = overId.slice(LANE_DROP_PREFIX.length).split(LANE_ID_SEPARATOR);
  if (epicId === undefined || epicId === '') return null;
  // Match against the lane list rather than casting: only a happy-path state has a lane, so an
  // id naming `blocked`/`abandoned` (or anything else) is not a lane, whatever its shape.
  const state = HAPPY_PATH_STATES.find((happy) => happy === rawState);
  return state === undefined ? null : { epicId, state };
}

/** The fields a lane drop reads off the dragged card. */
export type DraggedStory = Pick<CodeStory, 'ref' | 'factory_state' | 'epic_id'>;

export interface LaneMove {
  /** The dragged story, keyed the way `updateCodeState` wants it. */
  ref: string;
  /** The lane it was dropped on — the state to transition to. */
  state: HappyPathState;
  /**
   * True when the story is leaving `blocked`, whose reason the same write must clear — the PATCH
   * route only touches `blocked_reason` when the body carries the key, so omitting it would
   * strand the old reason on a story that is no longer blocked (mirrors the manual controls).
   */
  clearsBlockedReason: boolean;
}

/**
 * Resolve a drop onto a swimlane into the transition it should trigger, or `null` for a no-op:
 * dropped on nothing or on a non-lane, on a lane of ANOTHER epic (the gesture moves a story
 * between states, never between epics — that stays the detail modal's job), on the state the
 * story is already in, or for a card the server hasn't reconciled yet (no `ref` to PATCH).
 *
 * A `blocked` story sits in the lane it was blocked FROM, so its card can be dropped on that
 * same lane — `blocked` is not that lane's state, so the drop unblocks it back onto the board
 * rather than resolving to nothing.
 */
export function resolveLaneDrop(story: DraggedStory, overId: string | null): LaneMove | null {
  const lane = parseLaneDropId(overId);
  if (lane === null) return null;
  if (story.ref === null) return null;
  if (story.epic_id === null || story.epic_id !== lane.epicId) return null;
  if (story.factory_state === lane.state) return null;
  return {
    ref: story.ref,
    state: lane.state,
    clearsBlockedReason: story.factory_state === 'blocked',
  };
}
