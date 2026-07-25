import { resolveIngestClient } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { looksLikeHtmlDocument } from '@/lib/html-document';

/**
 * The upload cap. The generator emits ~30–50 KB, so 1 MB is generous headroom while still
 * bounding what a keyed caller can push into a `text` column.
 */
const MAX_BYTES = 1024 * 1024;

/** Does the header name `text/html`, ignoring any parameters (`; charset=utf-8`)? */
function isHtmlContentType(header: string | null): boolean {
  return header?.split(';', 1)[0]?.trim().toLowerCase() === 'text/html';
}

// ---------------------------------------------------------------------------
// POST /api/weekly-plans — archive one uploaded week-plan document
//
// Unlike every other handler this takes a RAW body, not JSON: the payload IS a file, so the
// ergonomic call is `curl --data-binary @week-plan-12.html` and JSON-escaping a 40 KB
// document from a shell is hostile. Any other Content-Type is rejected so the contract
// stays unambiguous.
//
// Auth is the existing keyed ingress (`resolveIngestClient`): a valid INGEST_API_KEY resolves
// the admin client, otherwise a logged-in session, otherwise 401.
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a Response directly on auth failure
  if (clientResult instanceof Response) return clientResult;

  const { supabase } = clientResult;

  if (!isHtmlContentType(request.headers.get('content-type'))) {
    return jsonError(415, 'Expected Content-Type: text/html');
  }

  const html = await request.text();
  if (html.trim() === '') return jsonError(400, 'Empty request body');
  if (new TextEncoder().encode(html).length > MAX_BYTES) {
    return jsonError(413, 'Weekly plan exceeds 1MB');
  }
  // Stored verbatim and never sanitized, so at least insist it IS a document — the same sniff
  // the code module uses to pick a spec's renderer.
  if (!looksLikeHtmlDocument(html)) return jsonError(400, 'Body must be an HTML document');

  const { data, error } = await supabase
    .from('weekly_plans')
    .insert({ html })
    // The caller just posted the document; echoing it back would double the response for nothing.
    .select('id, uploaded_at')
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
}
