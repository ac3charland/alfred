import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { researchReportSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { deliverResearchReport, getResearchPostForDelivery } from '@/lib/data/reader';
import { renderReportHtml } from '@/lib/reader/report-html';
import { hasDeliveryKey } from '@/lib/research/auth';
import { createAdminClient } from '@/lib/supabase/admin';

// ---------------------------------------------------------------------------
// PUT /api/reader/research/[id] — the research session delivers its report
//
// Not a session route. The caller is a Claude Code session with no cookie, authenticated by the
// research delivery key alone: `hasDeliveryKey` accepts nothing else — never the ingest key, which
// also creates items and weekly plans — and an unconfigured deployment accepts nothing at all.
// The session reads arbitrary web pages, so the worst a hijacked one can do here is overwrite the
// report of a research post that has not been delivered yet, by id. Once a report has landed the
// post refuses a second (409), so the first report wins.
//
// The answers, in the order the checks run: 401 (no or wrong key), 422 (a body that isn't
// `{ report }` with a non-blank report of at most 200 000 characters — the shared parse answers
// 400, and this contract says 422, so its answer is re-statused), 404 (no such post, an id that
// isn't a UUID, or a post that isn't research), 409 (already delivered), 200 `{ id }`.
//
// A queued, researching or failed post all take a report — a late report from a session the app
// gave up on is welcome — and so does an archived one, which lands in the archive. The write is one
// UPDATE through the admin client, guarded in its WHERE clause so two racing deliveries settle on
// one; it also resets the post's summary, so the Worker's tick summarises it like any post. The
// report's HTML is rendered here, once, with raw HTML in the markdown dropped.
//
// Node runtime, for the key's constant-time comparison. The report is never logged or echoed.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

/** What every refusal to deliver a second time says. */
const ALREADY_DELIVERED = 'already delivered';

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasDeliveryKey(request)) return jsonError(401, 'Unauthorized');

  const input = await parseRequestBody(request, researchReportSchema, 'Invalid report');
  if (input instanceof Response) return unprocessable(input);

  const { id: rawId } = await context.params;
  const id = parseUUID(rawId);
  if (id instanceof Response) return jsonError(404, 'Post not found');

  const admin = createAdminClient();
  const { data: post, error: readError } = await getResearchPostForDelivery(admin, id);
  if (readError) {
    const { status, message } = mapSupabaseError(readError);
    return jsonError(status, message);
  }
  if (post?.source !== 'research') return jsonError(404, 'Post not found');
  if (post.research_state === 'done') return jsonError(409, ALREADY_DELIVERED);

  const { data: delivered, error: writeError } = await deliverResearchReport(
    admin,
    id,
    input.report,
    renderReportHtml(input.report),
    new Date(),
  );
  if (writeError) {
    const { status, message } = mapSupabaseError(writeError);
    return jsonError(status, message);
  }
  // The guard matched nothing: between the read and the write another delivery landed.
  if (delivered === null) return jsonError(409, ALREADY_DELIVERED);

  return jsonOk({ id: delivered.id });
}

/**
 * The shared body parse's refusal, answered as the delivery contract has it: the same explanation
 * (which of the two it was, and the schema's issues), 422 rather than 400.
 */
async function unprocessable(refusal: Response): Promise<Response> {
  return Response.json(await refusal.json(), { status: 422 });
}
