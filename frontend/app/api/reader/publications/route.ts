import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createReaderPublicationSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import {
  createReaderFeed,
  createReaderPublication,
  findReaderFeed,
  getReaderPublications,
} from '@/lib/data/reader-publications';
import { feedHostName, normaliseFeedUrl, probeFeed } from '@/lib/reader/feed-probe';

// ---------------------------------------------------------------------------
// GET /api/reader/publications — the roster, ordered by name
// POST /api/reader/publications — put a sender (by handle) or a feed (by URL) on the roster
//
// A feed is fetched before it is stored: anything that isn't RSS or Atom is a 422 `not-a-feed`,
// a URL that doesn't answer (or answers non-2xx) a 422 `unreachable` quoting the status, and a
// feed already on the roster a 409 `duplicate` — checked first, with no fetch. The card is named from the feed's own title,
// else its host.
//
// POST returns the stored TABLE row, not the view: a publication created a moment ago has no
// posts yet, so there is no derived `last_post_at` to report and the client fills in `null`
// itself rather than this route re-reading the view for a value it already knows.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { data, error } = await getReaderPublications(session.supabase);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

/** PostgREST's code for a unique violation — here, a feed URL already on the roster. */
const UNIQUE_VIOLATION = '23505';

export const POST = withSession(async (session, request) => {
  const input = await parseRequestBody(request, createReaderPublicationSchema);
  if (input instanceof Response) return input;

  if ('feed_url' in input) {
    // The schema has already refused anything that isn't an http(s) URL, so this always parses.
    const feedUrl = normaliseFeedUrl(input.feed_url) ?? input.feed_url;
    // Already on the roster is the answer whether or not the blog answers today, and it costs no
    // fetch. The insert's unique violation below still catches a race with another add.
    const existing = await findReaderFeed(session.supabase, feedUrl);
    if (existing.error) {
      const { status, message } = mapSupabaseError(existing.error);
      return jsonError(status, message);
    }
    if (existing.data !== null) return jsonError(409, 'duplicate');

    const probe = await probeFeed(feedUrl);
    if (probe.kind === 'not-a-feed') return jsonError(422, 'not-a-feed');
    if (probe.kind === 'unreachable') {
      return Response.json(
        { error: 'unreachable', ...(probe.status === undefined ? {} : { status: probe.status }) },
        { status: 422 },
      );
    }

    const { data, error } = await createReaderFeed(session.supabase, {
      feedUrl,
      name: input.name ?? probe.title ?? feedHostName(feedUrl),
      ...(input.summary_kind === undefined ? {} : { summaryKind: input.summary_kind }),
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return jsonError(409, 'duplicate');
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    return jsonOk(data, 201);
  }

  const { data, error } = await createReaderPublication(session.supabase, input);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
