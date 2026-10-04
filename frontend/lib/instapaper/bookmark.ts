import 'server-only';

import type { InstapaperConfig } from '@/lib/instapaper/config';
import { textToHtml } from '@/lib/instapaper/content';
import { oauthNonce, oauthTimestamp, signRequest } from '@/lib/instapaper/oauth';
import { isWebUrl } from '@/lib/reader/open-link';

/**
 * Saving one post to Instapaper: what the request carries, and what its answer means.
 *
 * `bookmarks/add` is the Full API's one write this story needs. Two choices inside it are worth
 * naming, because both are the difference between a post arriving whole and arriving as a stub:
 *
 * The BODY travels with the request. Instapaper's `content` parameter makes it parse what it is
 * given instead of fetching the URL itself — which is how a paid post the owner subscribes to
 * arrives in full rather than as the web paywall's teaser. The body falls down a ladder: the
 * email's own HTML, else the stored text rendered as paragraphs, else nothing at all (and with
 * no `content`, Instapaper fetches the link, which is the right outcome for a post whose body
 * the retention sweep took).
 *
 * A post with NO web link still goes, as `is_private_from_source=email` with no `url` —
 * Instapaper's own mechanism for mail that has no permanent address. The Gmail permalink the
 * row's "Original" link falls back to is deliberately never sent: Instapaper would save a login
 * wall.
 */

/** The path `bookmarks/add` lives at, appended to the configured API origin. */
const ADD_PATH = '/api/1/bookmarks/add';

/**
 * How long a send waits. The owner is watching a row that has already started leaving, so a
 * request that hangs has to become a visible failure rather than a spinner — and a rolled-back
 * row they can press again beats a send whose outcome they never learn.
 */
export const ADD_TIMEOUT_MS = 15_000;

/** Exactly the columns a send reads. Nothing else about the post reaches Instapaper. */
export interface SendablePost {
  title: string;
  canonical_url: string | null;
  gist: string | null;
  html: string | null;
  text: string | null;
}

/**
 * What came back. A discriminated outcome rather than a throw, because two of the three are
 * ordinary answers the route turns into a sentence for the owner:
 *
 * - `saved` — Instapaper holds the post, and `bookmarkId` is its id.
 * - `refused` — Instapaper understood and declined, carrying its own numeric error code. The
 *   route maps the code to a sentence; Instapaper's accompanying `message` is documented as not
 *   intended to be displayed to users, so it is logged and never shown.
 * - `unavailable` — nothing can be concluded: a timeout, a network error, a 5xx, or a body that
 *   is not the JSON array the API documents. Nothing is written to the row either way, so this
 *   is simply "try again".
 */
export type AddBookmarkOutcome =
  | { kind: 'saved'; bookmarkId: number }
  | { kind: 'refused'; code: number }
  | { kind: 'unavailable' };

/**
 * The form parameters for one post, or `null` when there is nothing to send at all — no web link
 * AND no body. Instapaper needs one or the other: with neither, there is no article and no
 * address to find one at, and the route refuses before any outbound call.
 */
export function buildBookmarkParams(post: SendablePost): [string, string][] | null {
  const canonical = post.canonical_url?.trim();
  const url = canonical !== undefined && isWebUrl(canonical) ? canonical : undefined;

  const content = post.html?.trim() ?? '';
  const body = content === '' ? textToHtml(post.text ?? '') : content;

  if (url === undefined && body === '') return null;

  const parameters: [string, string][] = [];
  if (url === undefined) {
    // Instapaper's own flag for mail with no permanent URL. Without it a `url`-less add is
    // rejected; with it the bookmark is private to the account, which is what a newsletter the
    // owner subscribes to already is.
    parameters.push(['is_private_from_source', 'email']);
  } else {
    parameters.push(['url', url]);
  }

  // Sent so Instapaper skips its own synchronous title lookup — and so the list reads with the
  // post's real subject line rather than whatever the parser makes of the mail's markup.
  parameters.push(['title', post.title]);
  // alfred's one-paragraph take, under each post in the Instapaper list. Only when there is one:
  // a `pending` or `failed` post has no gist and an empty description is noise.
  if (post.gist !== null && post.gist.trim() !== '') parameters.push(['description', post.gist]);
  if (body !== '') parameters.push(['content', body]);

  // `resolve_final_url` is deliberately omitted, taking Instapaper's default of 1: Substack's
  // canonical links are `open.substack.com/pub/…/p/…` redirects, and the resolved address is the
  // one worth storing.
  return parameters;
}

/** `{ "type": "bookmark", "bookmark_id": … }`, the one answer that means the post is saved. */
function readBookmarkId(entry: Record<string, unknown>): number | undefined {
  if (entry['type'] !== 'bookmark') return undefined;
  const id = entry['bookmark_id'];
  return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
}

/** `{ "type": "error", "error_code": …, "message": … }`. */
function readErrorCode(entry: Record<string, unknown>): number | undefined {
  if (entry['type'] !== 'error') return undefined;
  const code = entry['error_code'];
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

/**
 * Read Instapaper's answer. It replies with a JSON ARRAY holding one object, so the shape is
 * checked rather than assumed: the API's own docs say to treat a body that is not JSON as a
 * 503, and an array of something unrecognised is the same situation — alfred cannot tell whether
 * the post was saved, so it says so instead of guessing.
 */
export function readAddResponse(status: number, body: unknown): AddBookmarkOutcome {
  // A 401/403 is the credentials, not the post. It arrives with no useful body, and the route
  // has its own sentence for it.
  if (status === 401 || status === 403) return { kind: 'refused', code: status };
  if (!Array.isArray(body)) return { kind: 'unavailable' };

  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const bookmarkId = readBookmarkId(record);
    if (bookmarkId !== undefined) return { kind: 'saved', bookmarkId };
    const code = readErrorCode(record);
    if (code !== undefined) return { kind: 'refused', code };
  }

  return { kind: 'unavailable' };
}

/**
 * POST one bookmark. Form-encoded and OAuth-signed, with the same parameter list in the
 * signature and the body — the signer is handed the parameters rather than the encoded string so
 * the two cannot drift.
 *
 * Every failure mode collapses into the outcome type: an abort, a DNS failure and a 500 are all
 * `unavailable`, because the route does the same thing with each. Nothing here logs the
 * credentials, the header or the body.
 */
export async function addBookmark(
  config: InstapaperConfig,
  parameters: [string, string][],
): Promise<AddBookmarkOutcome> {
  const url = `${config.apiUrl}${ADD_PATH}`;
  const authorization = signRequest(
    'POST',
    url,
    parameters,
    {
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      token: config.accessToken,
      tokenSecret: config.accessTokenSecret,
    },
    { nonce: oauthNonce(), timestamp: oauthTimestamp() },
  );

  const body = new URLSearchParams(parameters).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
      signal: AbortSignal.timeout(ADD_TIMEOUT_MS),
    });
  } catch {
    // A timeout, a reset connection, a DNS failure. The post was not necessarily missed, so the
    // caller writes nothing and tells the owner to try again.
    return { kind: 'unavailable' };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // Instapaper's docs say to read a non-JSON body as a 503 — it is their error page, not an
    // answer about this post.
    return { kind: 'unavailable' };
  }

  return readAddResponse(response.status, parsed);
}
