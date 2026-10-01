import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { sendFurtherReadingSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import {
  appendFurtherReadingSent,
  getReaderPostForFurtherReading,
  getReaderPostListItem,
} from '@/lib/data/reader';
import {
  type AddBookmarkOutcome,
  type InstapaperRefusal,
  type SendFailure,
  addBookmark,
  buildLinkBookmarkParams,
  listFolders,
  sendFailureResponse,
} from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';
import { furtherReadingOf, isReaderOverview } from '@/lib/reader/overview';
import type { ReaderFurtherReading } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/further-reading — send ticked Further reading links to Instapaper
//
// `destination: 'reader'` saves each link into Instapaper's "To Reader" folder, which the Worker's
// Reader tick already takes articles from and summarises — so a send to the Reader needs no Worker
// change at all. `destination: 'instapaper'` saves each to Unread. Either way a link is saved by
// URL alone, with the model's title and its note as the description: Instapaper fetches the page,
// following a Substack redirect wrapper to the article.
//
// The links are saved ONE AT A TIME, each under the client's own 15 s timeout, and no new save is
// started 20 s in, so the route answers inside the function's limit. Only saves Instapaper
// confirmed are marked, in one atomic append at the end: a partial send answers 200 with the row
// and the links that didn't go (and why, in a phrase the toast can finish a sentence with); a send
// where nothing landed answers the first failure's status and sentence, marking nothing.
//
// Each requested link must still be in the post's current overview (a re-summarise can reword the
// list under an open tab) and not already sent to either place — a link goes once. A send with
// nothing left answers the row unchanged and calls nobody.
//
// Order: configuration (501 before any read), the body, the pre-read, the folder lookup (Reader
// only — a missing folder is a 409 with nothing saved), the saves, the append. Logging names the
// post, the outcome and Instapaper's error code — never the credentials.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

/** How long the route keeps starting saves, inside the function's own time limit. */
const SEND_BUDGET_MS = 20_000;

const NO_FOLDER = 'There is no “To Reader” folder in Instapaper';

/** A failed save's sentence, as the shared send map words it — with the two about "this post" reworded for a link. */
function linkFailure(outcome: Exclude<AddBookmarkOutcome, { kind: 'saved' }>): SendFailure {
  const failure = sendFailureResponse(outcome);
  if (outcome.kind !== 'refused') return failure;
  if (outcome.refusal === 'invalid-url') {
    return { ...failure, detail: "Instapaper didn't accept that link" };
  }
  if (outcome.refusal === 'needs-content') {
    return { ...failure, detail: "Instapaper couldn't fetch that link" };
  }
  return failure;
}

/**
 * What went wrong for the links a partial send left behind, as a phrase the owner's toast ends
 * with "… for the rest" — so it names the cause without repeating the advice a full sentence has.
 */
const PARTIAL_PHRASES: Record<InstapaperRefusal | 'unavailable', string> = {
  'opted-out': 'Instapaper refused',
  'needs-content': "Instapaper couldn't fetch the page",
  'invalid-url': "Instapaper didn't accept the link",
  'rate-limited': 'Instapaper is rate-limiting',
  credentials: "Instapaper rejected alfred's credentials",
  premium: 'Instapaper needs a Premium account',
  unavailable: "Instapaper didn't answer",
};

function partialPhrase(outcome: Exclude<AddBookmarkOutcome, { kind: 'saved' }> | undefined) {
  return PARTIAL_PHRASES[outcome?.kind === 'refused' ? outcome.refusal : 'unavailable'];
}

/** The requested links that may go: in the overview, not yet sent anywhere, each once, in request order. */
function sendable(
  urls: readonly string[],
  offered: readonly ReaderFurtherReading[],
  sent: ReadonlySet<string>,
): ReaderFurtherReading[] {
  const byUrl = new Map(offered.map((item) => [item.url, item]));
  const items: ReaderFurtherReading[] = [];
  for (const url of new Set(urls)) {
    const item = byUrl.get(url);
    if (item !== undefined && !sent.has(url)) items.push(item);
  }
  return items;
}

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const config = getInstapaperConfig();
    if (config === null) return jsonError(501, "Instapaper isn't set up on this deployment");

    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, sendFurtherReadingSchema);
    if (input instanceof Response) return input;

    const { data: post, error: readError } = await getReaderPostForFurtherReading(
      session.supabase,
      id,
    );
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const offered = isReaderOverview(post.overview) ? furtherReadingOf(post.overview) : [];
    const sent = new Set([...post.further_sent_reader, ...post.further_sent_instapaper]);
    const items = sendable(input.urls, offered, sent);

    if (items.length === 0) {
      const { data: row, error } = await getReaderPostListItem(session.supabase, id);
      if (error) {
        const { status, message } = mapSupabaseError(error);
        return jsonError(status, message);
      }
      if (row === null) return jsonError(404, 'Post not found');
      return jsonOk({ post: row, unsent: [] });
    }

    const started = performance.now();

    let folderId: number | undefined;
    if (input.destination === 'reader') {
      const listing = await listFolders(config);
      if (listing.kind !== 'listed') {
        console.warn('reader: further reading folder lookup failed', {
          postId: id,
          outcome: listing.kind,
          code: listing.code,
        });
        const { status, detail } = sendFailureResponse(listing);
        return jsonError(status, detail);
      }
      const folder = listing.folders.find((candidate) => candidate.title === 'To Reader');
      if (folder === undefined) return jsonError(409, NO_FOLDER);
      folderId = folder.folderId;
    }

    const saved: string[] = [];
    const unsent: string[] = [];
    let firstFailure: Exclude<AddBookmarkOutcome, { kind: 'saved' }> | undefined;
    for (const item of items) {
      if (performance.now() - started >= SEND_BUDGET_MS) {
        unsent.push(item.url);
        continue;
      }
      const outcome = await addBookmark(config, buildLinkBookmarkParams(item, folderId));
      if (outcome.kind === 'saved') {
        saved.push(item.url);
        continue;
      }
      console.warn('reader: further reading link saved nothing', {
        postId: id,
        destination: input.destination,
        outcome: outcome.kind,
        code: outcome.code,
      });
      firstFailure ??= outcome;
      unsent.push(item.url);
    }

    if (saved.length === 0) {
      // Nothing landed — at least one save was started, and it failed.
      const { status, detail } = linkFailure(
        firstFailure ?? { kind: 'unavailable', code: undefined },
      );
      return jsonError(status, detail);
    }

    const { data: row, error: appendError } = await appendFurtherReadingSent(
      session.supabase,
      id,
      input.destination,
      saved,
    );
    if (appendError || row === null) {
      console.error(
        'reader further reading: saved, but could not mark the links sent',
        appendError,
      );
      return jsonError(500, "Saved to Instapaper, but couldn't mark the links as sent");
    }

    return jsonOk(
      unsent.length === 0
        ? { post: row, unsent }
        : { post: row, unsent, failure: partialPhrase(firstFailure) },
    );
  },
);
