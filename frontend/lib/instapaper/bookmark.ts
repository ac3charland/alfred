import 'server-only';

import { postWebUrl } from '@/lib/reader/open-link';

import type { InstapaperConfig } from './config';
import { textToHtml } from './content';
import { signRequest } from './oauth';

/**
 * Saving one Reader post to Instapaper through its Full API (`POST /api/1/bookmarks/add`).
 *
 * The request carries the post's own body as `content`, so Instapaper parses the article out of
 * the email the owner received — the same thing its email-in feature does with a forwarded
 * newsletter — instead of fetching the web page, which for a paid post is the paywall's teaser.
 * No tags and no folder: a sent post lands in Unread like anything else the owner saves, and a
 * tag is left for the owner to apply by hand as an act of choosing.
 */

/** What a send reads off the post: the route's own select, never the list payload. */
export interface BookmarkSource {
  title: string;
  canonical_url: string | null;
  gist: string | null;
  html: string | null;
  text: string | null;
}

/** How long a send waits on Instapaper before telling the owner it didn't answer. */
const TIMEOUT_MS = 15_000;

/**
 * The body a send carries, down a ladder: the email's HTML, else the stored text as paragraphs
 * (a post ingested before the HTML was kept), else nothing — and with nothing, Instapaper fetches
 * the link itself.
 */
function bookmarkContent(post: BookmarkSource): string | undefined {
  if (post.html !== null && post.html.trim() !== '') return post.html;
  const fromText = post.text === null ? '' : textToHtml(post.text);
  return fromText === '' ? undefined : fromText;
}

/**
 * The form parameters for one post, or null when there is nothing Instapaper could save: no web
 * link AND no body.
 *
 * A post with a body but no web link goes as `is_private_from_source=email` with no `url` —
 * Instapaper's own mechanism for mail that has no permanent address. The Original link's Gmail
 * permalink is deliberately never the `url`: Instapaper would save a login wall. `resolve_final_url`
 * is left at Instapaper's default (resolve), because Substack's links redirect.
 */
export function buildBookmarkParams(post: BookmarkSource): Record<string, string> | null {
  const url = postWebUrl(post);
  const content = bookmarkContent(post);
  if (url === undefined && content === undefined) return null;

  const params: Record<string, string> = {};
  if (url === undefined) params['is_private_from_source'] = 'email';
  else params['url'] = url;
  // The title saves Instapaper a synchronous lookup, and the gist puts alfred's one-paragraph
  // take under the post in the Instapaper list.
  params['title'] = post.title;
  const gist = post.gist?.trim();
  if (gist !== undefined && gist !== '') params['description'] = gist;
  if (content !== undefined) params['content'] = content;
  return params;
}

/** Why Instapaper said no, for the refusals the owner can be told something useful about. */
export type InstapaperRefusal =
  | 'opted-out'
  | 'needs-content'
  | 'invalid-url'
  | 'rate-limited'
  | 'credentials'
  | 'premium';

/**
 * What one send came to. `code` is Instapaper's `error_code` when it gave one — the only part of
 * its answer that is logged. Its `message` is documented as not intended for users and is read by
 * nothing here.
 */
export type AddBookmarkOutcome =
  | { kind: 'saved'; bookmarkId: number }
  | { kind: 'refused'; refusal: InstapaperRefusal; code: number | undefined }
  | { kind: 'unavailable'; code: number | undefined };

/** The error codes that mean something specific to the owner. Anything else is "didn't answer". */
const REFUSAL_BY_CODE: ReadonlyMap<number, InstapaperRefusal> = new Map([
  [1221, 'opted-out'],
  [1220, 'needs-content'],
  [1240, 'invalid-url'],
  [1040, 'rate-limited'],
  [1042, 'credentials'],
  [1041, 'premium'],
]);

/** Instapaper answers with an array of typed objects: a bookmark, or an error, among others. */
function answerItems(raw: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Instapaper's docs say to treat a body that isn't JSON as a 503; the caller does.
    return [];
  }
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return items.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
}

/** Read Instapaper's answer into an outcome. */
function readAnswer(status: number, raw: string): AddBookmarkOutcome {
  const items = answerItems(raw);

  const error = items.find((item) => item['type'] === 'error');
  const code = typeof error?.['error_code'] === 'number' ? error['error_code'] : undefined;
  const refusal = code === undefined ? undefined : REFUSAL_BY_CODE.get(code);
  if (refusal !== undefined) return { kind: 'refused', refusal, code };
  if (status === 401 || status === 403) return { kind: 'refused', refusal: 'credentials', code };
  if (error !== undefined || status < 200 || status >= 300) return { kind: 'unavailable', code };

  const bookmark = items.find((item) => item['type'] === 'bookmark');
  const bookmarkId = bookmark?.['bookmark_id'];
  return typeof bookmarkId === 'number'
    ? { kind: 'saved', bookmarkId }
    : { kind: 'unavailable', code: undefined };
}

/**
 * Save one bookmark. Never throws: a timeout, a network failure and every answer Instapaper can
 * give come back as an outcome, so the route has exactly one thing to switch on.
 */
export async function addBookmark(
  config: InstapaperConfig,
  params: Readonly<Record<string, string>>,
): Promise<AddBookmarkOutcome> {
  const url = `${config.apiUrl}/api/1/bookmarks/add`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: signRequest('POST', url, params, config.credentials),
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return readAnswer(response.status, await response.text());
  } catch {
    return { kind: 'unavailable', code: undefined };
  }
}

/** A failed send, as the route answers it: the status, and the sentence the owner's toast says. */
export interface SendFailure {
  status: 422 | 429 | 502;
  detail: string;
}

const SEND_FAILURES: Record<InstapaperRefusal | 'unavailable', SendFailure> = {
  'opted-out': { status: 422, detail: 'This publication has opted out of Instapaper' },
  'needs-content': {
    status: 422,
    detail: "Instapaper can't fetch this post itself, and its stored text is gone",
  },
  'invalid-url': { status: 422, detail: "Instapaper didn't accept this post's link" },
  'rate-limited': { status: 429, detail: 'Instapaper is rate-limiting — try again in a minute' },
  credentials: { status: 502, detail: "Instapaper rejected alfred's credentials" },
  premium: { status: 502, detail: 'Instapaper says this needs a Premium account' },
  unavailable: { status: 502, detail: "Instapaper didn't answer — try again" },
};

/**
 * The route's answer for a send that saved nothing. 422 is about this post, 429 about the moment,
 * 502 about Instapaper or alfred's standing with it — and every one says, in the owner's terms,
 * what happened, because the owner is watching and a bare "failed" would leave them guessing.
 */
export function sendFailureResponse(
  outcome: Exclude<AddBookmarkOutcome, { kind: 'saved' }>,
): SendFailure {
  return SEND_FAILURES[outcome.kind === 'refused' ? outcome.refusal : 'unavailable'];
}
