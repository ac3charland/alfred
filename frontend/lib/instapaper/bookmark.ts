import 'server-only';

import type { ReaderPostForSend } from '@/lib/data/reader';
import { isWebUrl } from '@/lib/reader/open-link';

import type { InstapaperConfig } from './config';
import { textToHtml } from './content';
import { signRequest } from './oauth';

/**
 * Saving one Reader post to Instapaper through the Full API's `bookmarks/add`, and reading its
 * answer into something the send route can act on.
 *
 * The request carries the post's own body (`content`), so a paid post the owner subscribes to
 * arrives in full instead of as the paywall's teaser, and a post with no web link can still be
 * saved — as a private bookmark, Instapaper's own mechanism for mail with no permanent URL.
 */

/** How long a send waits on Instapaper before calling it unanswered. */
export const INSTAPAPER_TIMEOUT_MS = 15_000;

/** The part of a post a bookmark is built from. */
export type BookmarkSource = Pick<
  ReaderPostForSend,
  'title' | 'canonical_url' | 'gist' | 'html' | 'text'
>;

/** `bookmarks/add`'s form parameters, exactly as signed and sent. */
export type BookmarkParams = Record<string, string>;

/**
 * What came of a send. `refused` carries Instapaper's error code (or `unauthorized` for a bare
 * HTTP 401/403); `unavailable` is everything that never produced an answer worth reading — a
 * timeout, a network error, a 5xx, a body that isn't JSON.
 */
export type BookmarkOutcome =
  | { kind: 'saved'; bookmarkId: number }
  | { kind: 'refused'; code: number | 'unauthorized' }
  | { kind: 'unavailable' };

/**
 * The body a send carries, down a ladder: the email HTML when intake kept it, else the stored
 * text as paragraphs (a post ingested before the HTML was kept), else none.
 */
function bookmarkContent(post: BookmarkSource): string | undefined {
  if (post.html !== null && post.html.trim() !== '') return post.html;
  const fromText = post.text === null ? '' : textToHtml(post.text);
  return fromText === '' ? undefined : fromText;
}

/**
 * The form parameters for one post, or `null` when there is nothing to send: no web link for
 * Instapaper to fetch and no body to hand it. A link that isn't http(s) — a `javascript:` URL, or
 * no canonical URL at all — is never sent as `url`; in particular the Gmail permalink the Reader
 * falls back to would save a login wall, so a link-less post goes as a private bookmark instead.
 * No tags and no folder: the post lands in Unread like anything else the owner saves.
 */
export function buildBookmarkParams(post: BookmarkSource): BookmarkParams | null {
  const canonical = post.canonical_url?.trim();
  const url = canonical !== undefined && isWebUrl(canonical) ? canonical : undefined;
  const content = bookmarkContent(post);
  if (url === undefined && content === undefined) return null;

  const params: BookmarkParams = {};
  if (url === undefined) params['is_private_from_source'] = 'email';
  else params['url'] = url;
  // Passing the title spares Instapaper its own synchronous title lookup.
  params['title'] = post.title;
  // The gist sits under the post in Instapaper's list — alfred's one-paragraph take.
  if (post.gist !== null && post.gist.trim() !== '') params['description'] = post.gist;
  if (content !== undefined) params['content'] = content;
  return params;
}

interface InstapaperBookmark {
  type: 'bookmark';
  bookmark_id: number;
}

interface InstapaperError {
  type: 'error';
  error_code: number;
}

function isBookmark(value: unknown): value is InstapaperBookmark {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'bookmark' &&
    typeof (value as { bookmark_id?: unknown }).bookmark_id === 'number'
  );
}

function isError(value: unknown): value is InstapaperError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'error' &&
    typeof (value as { error_code?: unknown }).error_code === 'number'
  );
}

/**
 * Read Instapaper's answer. It is a JSON array holding a `bookmark` on success or an `error` with
 * an `error_code` on failure; its `message` is "not intended to be displayed to users", so it is
 * never carried out of here. A body that isn't JSON is a 503 by Instapaper's own docs.
 */
export function readBookmarkResponse(status: number, body: string): BookmarkOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  const error = items.find((item) => isError(item));
  if (error !== undefined) return { kind: 'refused', code: error.error_code };
  if (status === 401 || status === 403) return { kind: 'refused', code: 'unauthorized' };

  const bookmark = items.find((item) => isBookmark(item));
  if (status >= 200 && status < 300 && bookmark !== undefined) {
    return { kind: 'saved', bookmarkId: bookmark.bookmark_id };
  }
  return { kind: 'unavailable' };
}

/** POST one bookmark, signed, with a timeout. Never throws: every failure is an outcome. */
export async function addBookmark(
  config: InstapaperConfig,
  params: BookmarkParams,
): Promise<BookmarkOutcome> {
  const url = `${config.apiUrl}/api/1/bookmarks/add`;
  const entries = Object.entries(params);
  const authorization = signRequest('POST', url, entries, {
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    token: config.accessToken,
    tokenSecret: config.accessTokenSecret,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: new URLSearchParams(entries).toString(),
      signal: AbortSignal.timeout(INSTAPAPER_TIMEOUT_MS),
      cache: 'no-store',
    });
    return readBookmarkResponse(response.status, await response.text());
  } catch {
    return { kind: 'unavailable' };
  }
}

/** What the send route answers for a send that saved nothing: a status and a sentence for the owner. */
export interface BookmarkFailure {
  status: 422 | 429 | 502;
  detail: string;
}

const UNANSWERED: BookmarkFailure = { status: 502, detail: "Instapaper didn't answer — try again" };

/** Instapaper's error codes the owner can be told something useful about. */
const REFUSALS: Record<number | 'unauthorized', BookmarkFailure> = {
  1221: { status: 422, detail: 'This publication has opted out of Instapaper' },
  1220: {
    status: 422,
    detail: "Instapaper can't fetch this post itself, and its stored text is gone",
  },
  1240: { status: 422, detail: "Instapaper didn't accept this post's link" },
  1040: { status: 429, detail: 'Instapaper is rate-limiting — try again in a minute' },
  1042: { status: 502, detail: "Instapaper rejected alfred's credentials" },
  unauthorized: { status: 502, detail: "Instapaper rejected alfred's credentials" },
  1041: { status: 502, detail: 'Instapaper says this needs a Premium account' },
};

/** The route's answer for a failed send. Any code not named above reads as no answer at all. */
export function bookmarkFailure(
  outcome: Exclude<BookmarkOutcome, { kind: 'saved' }>,
): BookmarkFailure {
  if (outcome.kind === 'unavailable') return UNANSWERED;
  return REFUSALS[outcome.code] ?? UNANSWERED;
}
