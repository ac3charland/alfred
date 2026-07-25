import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// GET /api/weekly-plans/[id] — one archived plan, document included
//
// The week-plan picker's on-demand fetch: the shell seeds only the latest document, so
// switching to an older week pulls it through here (and the store caches it).
//
// Session-only on purpose: the INGEST_API_KEY is a write credential for the upload
// ingress, and there is no reason to widen it to reads.
// ---------------------------------------------------------------------------

export const GET = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const { data, error } = await session.supabase
      .from('weekly_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    if (data === null) return jsonError(404, 'Weekly plan not found');

    return jsonOk(data);
  },
);
