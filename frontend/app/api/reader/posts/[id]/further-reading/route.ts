import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { sendFurtherReadingSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import {
  type ReaderPostFurtherRow,
  appendFurtherReadingSent,
  getReaderPostForFurtherReading,
  getReaderPostListItem,
} from '@/lib/data/reader';
import {
  type AddBookmarkOutcome,
  type InstapaperRefusal,
  addBookmark,
  buildLinkBookmarkParams,
  listFolders,
  sendFailureResponse,
} from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';
import { postFurtherReading } from '@/lib/reader/overview';
import type { FurtherReadingSendResult, ReaderFurtherReading } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/further-reading — save ticked Further reading links to Instapaper
//
// `reader` saves each link into the owner's Instapaper folder "To Reader", which the Worker's tick
// already reads: within a tick or two it takes the bookmark, archives it and summarises it as an
// Instapaper post — so sending to the Reader needs nothing new on the Worker's side. `instapaper`
// saves it to Unread. Either way a link is saved by URL, titled with the model's name for the
// piece and described with what the post uses it for; Instapaper fetches the page, following the
// redirect a newsletter's wrapped link is.
//
// One request per press. The links asked for are intersected with the post's CURRENT list (a
// re-summarise can reword it under an open tab) and any already sent, to either place, are
// dropped; with nothing left, the row answers unchanged and Instapaper is never called. Otherwise
// the order is: the folder listing (Reader only), then the saves one at a time, then one append of
// the links Instapaper confirmed. Saves stop STARTING once SAVE_WINDOW_MS has gone by since the
// request arrived, so the route answers inside the function's time limit even when Instapaper is
// slow.
//
// Only confirmed saves are marked. Some saved: 200 with the row, the links that went and those
// that didn't, and what stopped them, so the toast can say "Sent 1 of 2 to Reader — Instapaper didn't answer for
// the other". None saved: the first failure's status and sentence, as the post's own Send answers.
// A missing folder is the owner's to fix and alfred never creates one: 409, nothing saved.
//
// Logging names the post, the outcome and Instapaper's error code — never the credentials.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

/** The folder a send to the Reader saves into — the one the Worker's To Reader leg reads. */
const TO_READER_FOLDER = 'To Reader';

/**
 * How long after the request arrives the route keeps STARTING saves. Each save may take up to its
 * own 15 s timeout, so the last one started ends by ~35 s — inside the function's limit, with room
 * for the append.
 */
const SAVE_WINDOW_MS = 20_000;

/** A save that never started because the window closed. */
interface Unstarted {
  kind: 'out-of-time';
}

type SaveFailure = Exclude<AddBookmarkOutcome, { kind: 'saved' }> | Unstarted;

/** What stopped the links that didn't go, as the end of "Sent k of n to … — ___ for the rest". */
const PARTIAL_WORDS: Readonly<Record<InstapaperRefusal | 'unavailable' | 'out-of-time', string>> = {
  'opted-out': 'the publication has opted out of Instapaper',
  'needs-content': "Instapaper couldn't fetch the page",
  'invalid-url': "Instapaper didn't accept the link",
  'rate-limited': 'Instapaper is rate-limiting',
  credentials: "Instapaper rejected alfred's credentials",
  premium: 'Instapaper says this needs a Premium account',
  unavailable: "Instapaper didn't answer",
  'out-of-time': 'Instapaper was too slow',
};

function partialWords(failure: SaveFailure): string {
  return PARTIAL_WORDS[failure.kind === 'refused' ? failure.refusal : failure.kind];
}

/**
 * The post's current sendable links, by URL — an essay's Further reading or a roundup's Links,
 * read by the kind the post was summarised under; none for an overview without a list.
 */
function offeredItems(post: ReaderPostFurtherRow): Map<string, ReaderFurtherReading> {
  return new Map(postFurtherReading(post).map((item) => [item.url, item]));
}

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    // The window is the whole request's, folder listing included, so the answer stays inside the
    // function's time limit however slow the listing was.
    const started = performance.now();
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const config = getInstapaperConfig();
    if (config === null) return jsonError(501, "Instapaper isn't set up on this deployment");

    const input = await parseRequestBody(request, sendFurtherReadingSchema);
    if (input instanceof Response) return input;
    const { destination } = input;

    const { data: post, error: readError } = await getReaderPostForFurtherReading(
      session.supabase,
      id,
    );
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const offered = offeredItems(post);
    const sent = new Set([...post.further_sent_reader, ...post.further_sent_instapaper]);
    const items = [...new Set(input.urls)]
      .filter((url) => !sent.has(url))
      .map((url) => offered.get(url))
      .filter((item) => item !== undefined);

    if (items.length === 0) {
      const { data: row, error } = await getReaderPostListItem(session.supabase, id);
      if (error) {
        const { status, message } = mapSupabaseError(error);
        return jsonError(status, message);
      }
      if (row === null) return jsonError(404, 'Post not found');
      return jsonOk({ post: row, sent: [], unsent: [] } satisfies FurtherReadingSendResult);
    }

    let folderId: number | undefined;
    if (destination === 'reader') {
      const listing = await listFolders(config);
      if (listing.kind !== 'listed') {
        console.warn('reader: further reading folder listing failed', {
          postId: id,
          outcome: listing.kind,
          code: listing.code,
        });
        const { status, detail } = sendFailureResponse(listing);
        return jsonError(status, detail);
      }
      const folder = listing.folders.find((candidate) => candidate.title === TO_READER_FOLDER);
      if (folder === undefined) {
        return jsonError(409, `There is no “${TO_READER_FOLDER}” folder in Instapaper`);
      }
      folderId = folder.folderId;
    }

    const saved: string[] = [];
    const unsent: string[] = [];
    let failure: SaveFailure | undefined;
    for (const item of items) {
      if (performance.now() - started >= SAVE_WINDOW_MS) {
        failure ??= { kind: 'out-of-time' };
        unsent.push(item.url);
        continue;
      }
      const outcome = await addBookmark(config, buildLinkBookmarkParams(item, folderId));
      if (outcome.kind === 'saved') {
        saved.push(item.url);
        continue;
      }
      console.warn('reader: further reading save failed', {
        postId: id,
        outcome: outcome.kind,
        code: outcome.code,
      });
      failure ??= outcome;
      unsent.push(item.url);
    }

    if (saved.length === 0) {
      const { status, detail } = sendFailureResponse(
        failure === undefined || failure.kind === 'out-of-time'
          ? { kind: 'unavailable', code: undefined }
          : failure,
      );
      return jsonError(status, detail);
    }

    const { data: row, error: appendError } = await appendFurtherReadingSent(
      session.supabase,
      id,
      destination,
      saved,
    );
    if (appendError || row === null) {
      // The links are in Instapaper; only the marks are missing. A second press saves them again,
      // which Instapaper answers by moving the existing bookmark rather than duplicating it.
      console.error(
        'reader further reading: saved, but could not record the sent links',
        appendError,
      );
      return jsonError(500, "Saved to Instapaper, but couldn't mark the links as sent");
    }

    const result: FurtherReadingSendResult =
      failure === undefined
        ? { post: row, sent: saved, unsent }
        : { post: row, sent: saved, unsent, failure: partialWords(failure) };
    return jsonOk(result);
  },
);
