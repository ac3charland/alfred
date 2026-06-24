import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { nextOccurrence, parseRecurrenceRule } from '@/lib/recurrence';

// ---------------------------------------------------------------------------
// POST /api/tasks/[id]/complete
// ---------------------------------------------------------------------------

/**
 * Cascade-completes a task and all its descendants. Recurrence-aware: a top-level `task`
 * carrying a recurrence rule and a due date spawns its next occurrence atomically via the
 * `complete_and_spawn` RPC (the TS engine computes the next due date; the DB does the two
 * writes in one transaction) and returns `{ completed, spawned }`. Everything else — a
 * non-recurring task, a subtask, or the last occurrence of a finished series — takes the plain
 * `complete_subtree` path and returns the affected rows, exactly as before.
 *
 * The client confirms the cascade modal BEFORE calling this.
 */
export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    // Load just the recurrence metadata needed to decide plain-complete vs complete-and-spawn.
    const { data: task, error: loadError } = await supabase
      .from('items')
      .select('recurrence, due_date, occurrence_index, recurrence_series_id, parent_id, item_type')
      .eq('id', id)
      .single();
    if (loadError) {
      const { status, message } = mapSupabaseError(loadError);
      return jsonError(status, message);
    }

    // A recurring top-level task with a due date spawns its next occurrence — unless the
    // series has ended (nextOccurrence → null), in which case it just completes.
    const rule = parseRecurrenceRule(task.recurrence);
    const index = task.occurrence_index ?? 1;
    const nextDue =
      rule !== null &&
      task.parent_id === null &&
      task.item_type === 'task' &&
      task.due_date !== null
        ? nextOccurrence(rule, task.due_date, index)
        : null;

    if (nextDue !== null) {
      // Lazily stamp the lineage on the original the first time it recurs, so the RPC copies a
      // real series id onto the spawn (the DB column starts null; the original = index 1).
      if (task.recurrence_series_id === null) {
        const { error: tagError } = await supabase
          .from('items')
          .update({ recurrence_series_id: crypto.randomUUID(), occurrence_index: index })
          .eq('id', id);
        if (tagError) {
          const { status, message } = mapSupabaseError(tagError);
          return jsonError(status, message);
        }
      }

      const { data, error } = await supabase.rpc('complete_and_spawn', {
        root_id: id,
        next_due: nextDue,
        next_index: index + 1,
      });
      if (error) {
        const { status, message } = mapSupabaseError(error);
        return jsonError(status, message);
      }
      return jsonOk(data);
    }

    const { data, error } = await supabase.rpc('complete_subtree', { root_id: id });
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    return jsonOk(data);
  },
);
