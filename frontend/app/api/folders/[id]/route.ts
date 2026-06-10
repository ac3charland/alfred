import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateFolderSchema } from '@/lib/api/schemas';

// ---------------------------------------------------------------------------
// PATCH /api/folders/[id]
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const { supabase } = session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    const parsed = updateFolderSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, 'Invalid request body', parsed.error.issues);
    }

    const { data, error } = await supabase
      .from('folders')
      .update({ name: parsed.data.name })
      .eq('id', id)
      .select()
      .single();

    if (error) return jsonError(500, error.message);

    return jsonOk(data);
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/folders/[id]
// ---------------------------------------------------------------------------

export const DELETE = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const { supabase } = session;

    // ON DELETE SET NULL cascade: items in this folder return to Inbox
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) return jsonError(500, error.message);

    return jsonOk({ success: true });
  },
);
