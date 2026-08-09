import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateFolderSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { FolderUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/folders/[id]
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateFolderSchema);
    if (input instanceof Response) return input;

    // PATCH semantics: only set the fields the caller actually provided, so a rename leaves the
    // manual order alone and a reorder leaves the name alone. A present key — even `null` — is
    // forwarded (null clears the description); an absent one is left untouched. Building from
    // defined-only fields also satisfies exactOptionalPropertyTypes (zod `.optional()` yields
    // `T | undefined`).
    const updates = toUpdatePayload<FolderUpdate>(input, ['name', 'sort_order', 'description']);

    const { data, error } = await supabase
      .from('folders')
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
// DELETE /api/folders/[id]
// ---------------------------------------------------------------------------

export const DELETE = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    // ON DELETE SET NULL cascade: items in this folder return to Inbox
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk({ success: true });
  },
);
