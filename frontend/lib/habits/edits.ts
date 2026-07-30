import type { UpdateHabitInput } from '@/lib/api/schemas';
import type { Habit } from '@/lib/types';

/**
 * Editing a habit's definition — which fields a change may touch, and what the row looks like
 * afterwards. Pure, so the rule that protects stored history is table-tested rather than reached
 * through a route, and the store can paint the same merge the route will write.
 */

/**
 * The three fields frozen once a habit has a logged day.
 *
 * The split isn't arbitrary — it is exactly where retroactivity lives. A day's STATUS is frozen
 * when it is written, so retargeting a criterion is inert for history: a day that was `met`
 * against a 07:00 target stays `met` when the target tightens. These three are not stored per
 * day; scoring reads the habit's CURRENT values on every render, so dropping a weekday or
 * raising the allowance silently restates months of chain the owner already earned.
 */
export const LOCKED_FIELDS = ['active_days', 'allowance', 'started_on'] as const;

export type LockedField = (typeof LOCKED_FIELDS)[number];

/** Two weekday lists mean the same cadence when they hold the same days, in any order. */
function sameDays(current: number[], next: number[]): boolean {
  const currentDays = new Set(current);
  const nextDays = new Set(next);
  return currentDays.size === nextDays.size && [...nextDays].every((day) => currentDays.has(day));
}

/**
 * Which frozen fields this body actually CHANGES, in {@link LOCKED_FIELDS} order.
 *
 * A locked field carrying the value it already has is a no-op rather than a refusal: the edit
 * form naturally submits the fields it rendered, so rejecting a mere MENTION would fail every
 * save, while rejecting a change keeps the write idempotent and lets the client stay dumb.
 */
export function lockedFieldsChanged(current: Habit, input: UpdateHabitInput): LockedField[] {
  const changed: LockedField[] = [];
  if (input.active_days !== undefined && !sameDays(current.active_days, input.active_days)) {
    changed.push('active_days');
  }
  if (input.allowance !== undefined && input.allowance !== current.allowance) {
    changed.push('allowance');
  }
  if (input.started_on !== undefined && input.started_on !== current.started_on) {
    changed.push('started_on');
  }
  return changed;
}

/**
 * Why a save was refused, as a sentence a human reads — the refusal is a real answer, not a
 * stack trace, and the edit surface quotes it verbatim when the route turns a save down.
 */
export function lockedFieldsMessage(
  fields: LockedField[],
  habitName: string,
  entryCount: number,
): string {
  const listed =
    fields.length <= 1
      ? (fields[0] ?? '')
      : `${fields.slice(0, -1).join(', ')} and ${fields.at(-1) ?? ''}`;
  const verb = fields.length === 1 ? 'is' : 'are';
  const days = `${String(entryCount)} logged ${entryCount === 1 ? 'day' : 'days'}`;
  return `${listed} ${verb} fixed once a habit has history — ${habitName} has ${days}`;
}

/**
 * The row a habit becomes under this update — the optimistic paint, and the same merge the
 * route's payload builder writes.
 *
 * `archived` arrives as a boolean and becomes an instant here, so "when" stays derived rather
 * than accepted. An absent key leaves its column exactly as it was.
 */
export function applyHabitUpdate(habit: Habit, input: UpdateHabitInput, now: string): Habit {
  return {
    ...habit,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.criteria === undefined ? {} : { criteria: input.criteria }),
    ...(input.active_days === undefined ? {} : { active_days: input.active_days }),
    ...(input.allowance === undefined ? {} : { allowance: input.allowance }),
    ...(input.started_on === undefined ? {} : { started_on: input.started_on }),
    ...(input.archived === undefined ? {} : { archived_at: input.archived ? now : null }),
  };
}
