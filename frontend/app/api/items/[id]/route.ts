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
    ]);

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
