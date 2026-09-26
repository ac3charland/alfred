import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateItemSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { ItemUpdate } from '@/lib/types';

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

    // Knowledge leaves the Inbox only through POST /api/wiki/items. Migration 0038 lets a
    // dispatched knowledge row go folderless, so stamped here it would render in no view at all.
    // The type that counts is the one the row ends up with: this PATCH's, else the stored one.
    if (input.dispatched === true) {
      let itemType = input.item_type;
      if (itemType === undefined) {
        const { data: current, error: readError } = await supabase
          .from('items')
          .select('item_type')
          .eq('id', id)
          .single();
        if (readError) {
          const { status, message } = mapSupabaseError(readError);
          return jsonError(status, message);
        }
        itemType = current.item_type;
      }
      if (itemType === 'knowledge') {
        return jsonError(409, 'A knowledge item leaves the Inbox only by being sent to the wiki');
      }
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
