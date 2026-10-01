import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { sendFurtherReadingSchema } from '@/lib/api/reader-schemas';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { appendFurtherReadingSent, getReaderPostListItem } from '@/lib/data/reader';
import {
  TO_READER_FOLDER,
  listFolders,
  sendFailureResponse,
  sendLinks,
} from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';
import { furtherReadingOf, isReaderOverview } from '@/lib/reader/overview';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/further-reading — send ticked Further reading links onward
//
// Saves links the post's summary offered to the owner's Instapaper: to the "To Reader" folder
// (destination `reader`, where the Worker's next tick takes them in as posts of their own) or to
// Unread (destination `instapaper`). Each link goes as a bookmark by URL — Instapaper fetches the
// page itself — titled and described from the summary's own entry for it. Node runtime, for
// `node:crypto`.
//
// Each requested URL must still be in the post's current overview (a re-summarise can reword the
// list underneath an open tab; a link no longer offered is silently dropped), and any already
// sent to ANY destination is dropped too: a send with nothing left answers the row unchanged and
// calls nothing. The links are saved one at a time, so a partial result is possible — the answer
// lists the `unsent` ones and, when there are some, the first failure's sentence for the toast.
//
// The marks are recorded AFTER the saves, in one write of just the links that landed. Reserving
// them first would risk marking a link sent that never reached Instapaper; this way the worst case
// is a link in Instapaper that still reads unsent, and a second press only moves the existing
// bookmark to the top rather than duplicating it. If that write fails the route answers 500.
//
// Order: configuration first (an unconfigured deployment answers 501 before touching the
// database), then the id, the body, and the read. Logging names the post, destination, counts and
// Instapaper's error code — never the credentials or the links.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const startedAt = Date.now();

    const config = getInstapaperConfig();
    if (config === null) return jsonError(501, "Instapaper isn't set up on this deployment");

    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, sendFurtherReadingSchema);
    if (input instanceof Response) return input;
    const { destination, urls } = input;

    const { data: row, error: readError } = await getReaderPostListItem(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (row === null) return jsonError(404, 'Post not found');

    // In the overview's order, each once: the overview's entry also supplies the title and note.
    const requested = new Set(urls);
    const sent = new Set([...row.further_sent_reader, ...row.further_sent_instapaper]);
    const offered = isReaderOverview(row.overview) ? furtherReadingOf(row.overview) : [];
    const seen = new Set<string>();
    const candidates = offered.filter((item) => {
      if (!requested.has(item.url) || sent.has(item.url) || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    if (candidates.length === 0) return jsonOk({ post: row, unsent: [] });

    let folderId: number | undefined;
    if (destination === 'reader') {
      const folders = await listFolders(config);
      if (folders.kind !== 'listed') {
        console.warn('reader: further reading send could not list folders', {
          postId: id,
          outcome: folders.kind,
          code: folders.code,
        });
        const { status, detail } = sendFailureResponse(folders);
        return jsonError(status, detail);
      }
      folderId = folders.folders.find((folder) => folder.title === TO_READER_FOLDER)?.folderId;
      if (folderId === undefined) {
        return jsonError(409, 'There is no “To Reader” folder in Instapaper');
      }
    }

    const { landed, unsent, firstFailure } = await sendLinks(config, candidates, {
      ...(folderId === undefined ? {} : { folderId }),
      startedAt,
    });
    // A link left unstarted by the deadline, with no failure to quote, is told as a non-answer.
    const failure =
      unsent.length === 0
        ? undefined
        : sendFailureResponse(firstFailure ?? { kind: 'unavailable', code: undefined });

    if (unsent.length > 0) {
      console.warn('reader: further reading send incomplete', {
        postId: id,
        destination,
        landed: landed.length,
        unsent: unsent.length,
        code: firstFailure?.code,
      });
    }
    if (landed.length === 0 && failure !== undefined) {
      return jsonError(failure.status, failure.detail);
    }

    const { data: saved, error: appendError } = await appendFurtherReadingSent(
      session.supabase,
      id,
      destination,
      landed,
    );
    if (appendError || saved === null) {
      // The links are in Instapaper; only the marks are missing — see the header comment.
      console.error(
        'reader further reading send: saved, but could not record the sent links',
        appendError,
      );
      return jsonError(500, "Saved to Instapaper, but couldn't mark the links as sent");
    }
    return jsonOk({
      post: saved,
      unsent,
      ...(failure === undefined ? {} : { failure: failure.detail }),
    });
  },
);
