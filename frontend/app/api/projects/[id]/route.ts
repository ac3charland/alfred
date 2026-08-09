import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateProjectSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { ProjectUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/projects/[id] — the project's description, and nothing else (ALF-179)
//
// The only editable field a project has. `name`, `key`, `github_url` and the repo fields stay
// immutable: `key` is carried by every ref, branch name and PR frontmatter, so a rename is a
// feature with its own consequences rather than a side effect of a text column. The schema
// strips every other key, so a body naming one changes nothing. `null` clears the description.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateProjectSchema);
    if (input instanceof Response) return input;

    const updates = toUpdatePayload<ProjectUpdate>(input, ['description']);

    const { data, error } = await supabase
      .from('projects')
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
