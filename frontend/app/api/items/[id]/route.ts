import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateItemSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { ItemType, ItemUpdate } from '@/lib/types';

/**
 * The item types whose only way out of the Inbox is their own dispatch route, each with the 409
 * a PATCH that would leave one dispatched gets.
 */
const DISPATCH_ONLY_MESSAGE: Partial<Record<ItemType, string>> = {
  knowledge: 'A knowledge item leaves the Inbox only by being sent to the wiki',
  research: 'A research item leaves the Inbox only by being dispatched to research',
};

// ---------------------------------------------------------------------------
// PATCH /api/items/[id]
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateItemSchema);
    if (input instanceof Response) return input;

    // Knowledge and research each leave the Inbox only through their own route — POST
    // /api/wiki/items and POST /api/reader/research. The folder CHECK lets a dispatched knowledge
    // or research row go folderless, so one made here would render in no view at all.
    // What counts is the state the row ends up in: each of type and residency is this PATCH's,
    // else the stored one — so retyping a dispatched task to research is refused too, and the
    // type the row ENDS as names the refusal. Only a PATCH that moves the row toward such a
    // state (one of those types, or dispatched) needs the stored row.
    const towardGuardedType =
      input.item_type !== undefined && input.item_type in DISPATCH_ONLY_MESSAGE;
    const towardDispatched = input.dispatched === true;
    const settlesElsewhere =
      input.dispatched === false || (input.item_type !== undefined && !towardGuardedType);
    if ((towardGuardedType || towardDispatched) && !settlesElsewhere) {
      let endType = input.item_type;
      let endDispatched = towardDispatched ? true : undefined;
      if (endType === undefined || endDispatched === undefined) {
        const { data: current, error: readError } = await supabase
          .from('items')
          .select('item_type,dispatched_at')
          .eq('id', id)
          .single();
        if (readError) {
          const { status, message } = mapSupabaseError(readError);
          return jsonError(status, message);
        }
        endType ??= current.item_type;
        endDispatched ??= current.dispatched_at !== null;
      }
      const refusal = endDispatched ? DISPATCH_ONLY_MESSAGE[endType] : undefined;
      if (refusal !== undefined) return jsonError(409, refusal);
    }

    // PATCH semantics: only set the fields the caller actually provided (a present `null`
    // clears a nullable column). Building from defined-only fields also satisfies
    // exactOptionalPropertyTypes (zod `.optional()` yields `T | undefined`).
    const updates = toUpdatePayload<ItemUpdate>(input, [
      'title',
      'notes',
      'source_url',
      'due_date',
      'folder_id',
      'parent_id',
      'item_type',
      'status',
      'recurrence',
      'priority',
      'sort_order',
      'intended_project_id',
      'intended_epic_id',
    ]);

    // `dispatched` is an intent, not a column, so it can't ride the field list above. The server
    // authors the instant: true stamps now, false returns the item to the Inbox, absent leaves
    // residency untouched (PATCH semantics, like every other field here).
    if (input.dispatched !== undefined) {
      updates.dispatched_at = input.dispatched ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk(data);
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/items/[id]
// ---------------------------------------------------------------------------

export const DELETE = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk({ success: true });
  },
);
