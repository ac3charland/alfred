import 'server-only';

import { isWebUrl } from '@/lib/reader/open-link';

import type { InstapaperConfig } from './config';
import { textToHtml } from './content';
import { type OAuthStamp, freshStamp, signRequest } from './oauth';

/**
 * Saving one Reader post to Instapaper through the Full API's `bookmarks/add`.
 *
 * `server-only`: the call is signed with the owner's OAuth secrets, so it only ever runs inside
 * a route handler. Nothing in this file reads the database or the environment — the route
 * hands it a post and a config, which keeps every branch below testable with a stubbed `fetch`.
 */

/** The parts of a stored Reader post that decide what Instapaper is sent. */
export interface SendablePost {
  title: string;
  canonical_url: string | null;
  gist: string | null;
  html: string | null;
  text: string | null;
}

/** Is there anything in this string once the padding is gone? */
function hasText(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/**
 * What to send for a post, or `null` when there is nothing Instapaper could store.
 *
 * A bookmark is a link, a body, or both:
 *  - the post's canonical URL, when it is a web address — `isWebUrl` is the same check the
 *    row's "Original" link applies to the same column, since both land the value somewhere that
 *    would follow a `javascript:` link;
 *  - the stored HTML, else the stored text rendered as paragraphs, so Instapaper keeps what
 *    the mail actually said and doesn't have to fetch it (many newsletter links sit behind a
 *    login, and a post with no link has nothing to fetch at all).
 *
 * With a body but no link the bookmark is marked `is_private_from_source=email`, which is how
 * Instapaper is told the content has no public URL to fetch it from.
 *
 * Deliberately never sent: `tags` and `folder_id` (Instapaper's own defaults are right — the
 * owner files things by hand), and `resolve_final_url` (Substack canonical links redirect, and
 * the default of following that redirect is what lands the real article).
 */
export function buildBookmarkParams(post: SendablePost): Record<string, string> | null {
  const canonical = post.canonical_url?.trim();
  const url = canonical !== undefined && isWebUrl(canonical) ? canonical : undefined;

  let content: string | undefined;
  if (hasText(post.html)) {
    content = post.html;
  } else if (hasText(post.text)) {
    content = textToHtml(post.text);
  }

  if (url === undefined && content === undefined) return null;

  return {
    title: post.title,
    ...(url !== undefined && { url }),
    ...(content !== undefined && { content }),
    ...(url === undefined && { is_private_from_source: 'email' }),
    ...(hasText(post.gist) && { description: post.gist }),
  };
}

/**
 * How the call turned out, collapsed to what the route needs to decide its answer.
 * `refused` is Instapaper understanding the request and saying no, with its numeric reason;
 * `unauthorized` is the credentials not being accepted; `unavailable` is everything else that
 * went wrong — a failed connection, a timeout, a 5xx, an answer that isn't the JSON the API
 * documents. Instapaper's own `message` text is deliberately absent: its docs say it is not
 * intended to be displayed to users.
 */
export type AddBookmarkOutcome =
  | { kind: 'saved'; bookmarkId: number }
  | { kind: 'refused'; code: number }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' };

export interface AddBookmarkOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** How long to wait for Instapaper before giving up. */
  timeoutMs?: number;
  /** Injected for tests; defaults to a fresh nonce and the current time. */
  stamp?: OAuthStamp;
}

/**
 * Long enough for Instapaper to fetch and parse a slow page when it has to; short enough that
 * a click on the verb never hangs for a minute. A request that timed out may still have landed,
 * which is the price of giving an answer at all.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

const UNAVAILABLE: AddBookmarkOutcome = { kind: 'unavailable' };

/** An object with string keys, or nothing — `typeof null` is `'object'`, so say it plainly. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Instapaper answers with a JSON array holding one object per result: a `bookmark` on
 * success, an `error` otherwise. Anything that isn't one of those two shapes reads as no
 * answer at all.
 */
function readAnswer(body: unknown): AddBookmarkOutcome {
  if (!Array.isArray(body)) return UNAVAILABLE;

  for (const entry of body as unknown[]) {
    if (!isRecord(entry)) continue;
    if (entry['type'] === 'bookmark' && typeof entry['bookmark_id'] === 'number') {
      return { kind: 'saved', bookmarkId: entry['bookmark_id'] };
    }
    if (entry['type'] === 'error' && typeof entry['error_code'] === 'number') {
      return { kind: 'refused', code: entry['error_code'] };
    }
  }
  return UNAVAILABLE;
}

/**
 * Add one bookmark. Never throws: every way this can go wrong is an outcome the route maps to
 * an answer, so a flaky Instapaper can't turn a click into an unhandled 500.
 *
 * The body is form-encoded, but the signature is computed over the DECODED values with RFC
 * 5849 percent-encoding — `URLSearchParams` writes a space as `+`, which would give a signature
 * Instapaper can't reproduce.
 */
export async function addBookmark(
  config: InstapaperConfig,
  params: Record<string, string>,
  options: AddBookmarkOptions = {},
): Promise<AddBookmarkOutcome> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const url = `${config.apiUrl}/api/1/bookmarks/add`;

  try {
    const authorization = signRequest(
      'POST',
      url,
      params,
      {
        consumerKey: config.consumerKey,
        consumerSecret: config.consumerSecret,
        token: config.accessToken,
        tokenSecret: config.accessTokenSecret,
      },
      options.stamp ?? freshStamp(),
    );

    const response = await fetchImplementation(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Authorization: authorization,
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    // The credentials verdict doesn't depend on what the body says.
    if (response.status === 401 || response.status === 403) return { kind: 'unauthorized' };
    if (response.status >= 500) return UNAVAILABLE;

    // Instapaper's docs: treat a body that isn't JSON as a 503.
    return readAnswer((await response.json()) as unknown);
  } catch {
    // A refused connection, a timeout, an unparseable body, an unusable API URL — all the
    // same to the person clicking: it didn't go through, and trying again is the remedy.
    return UNAVAILABLE;
  }
}

/** The route's answer when a send fails: an HTTP status and a sentence the UI can show as is. */
export interface SendFailure {
  status: number;
  message: string;
}

/** Answered before any call is made: this deployment has no Instapaper credentials. */
export const NOT_CONFIGURED = {
  status: 501,
  message: "Instapaper isn't set up on this deployment",
} as const;

/** Answered before any call is made: the post has no link and nothing stored to send instead. */
export const NOTHING_TO_SEND = {
  status: 409,
  message: 'Nothing to send — this post has no link and no stored text',
} as const;

const OPTED_OUT: SendFailure = {
  status: 422,
  message: 'This publication has opted out of Instapaper',
};
const NEEDS_CONTENT: SendFailure = {
  status: 422,
  message: "Instapaper can't fetch this post itself, and its stored text is gone",
};
const BAD_LINK: SendFailure = { status: 422, message: "Instapaper didn't accept this post's link" };
const RATE_LIMITED: SendFailure = {
  status: 429,
  message: 'Instapaper is rate-limiting — try again in a minute',
};
const REJECTED_CREDENTIALS: SendFailure = {
  status: 502,
  message: "Instapaper rejected alfred's credentials",
};
const NEEDS_PREMIUM: SendFailure = {
  status: 502,
  message: 'Instapaper says this needs a Premium account',
};
const NO_ANSWER: SendFailure = { status: 502, message: "Instapaper didn't answer — try again" };

/**
 * The HTTP status and message for a failed send. The messages are alfred's own wording, keyed
 * on Instapaper's documented error codes; an unrecognised code falls through to "didn't
 * answer" — the honest summary of "something we don't have a sentence for went wrong".
 *
 * A 422 means the post itself can't be sent (retrying won't help), a 429 means wait, and a 502
 * means the problem is between alfred and Instapaper rather than in the post.
 */
export function sendFailure(outcome: Exclude<AddBookmarkOutcome, { kind: 'saved' }>): SendFailure {
  switch (outcome.kind) {
    case 'unauthorized': {
      return REJECTED_CREDENTIALS;
    }
    case 'unavailable': {
      return NO_ANSWER;
    }
    case 'refused': {
      switch (outcome.code) {
        // The publication told Instapaper not to store its posts.
        case 1221: {
          return OPTED_OUT;
        }
        // The page needs the full content supplied, and there is none stored to supply.
        case 1220: {
          return NEEDS_CONTENT;
        }
        // Instapaper rejected the URL as invalid.
        case 1240: {
          return BAD_LINK;
        }
        // This application is being rate limited.
        case 1040: {
          return RATE_LIMITED;
        }
        // The application registration itself is suspended — a credentials problem, not the post's.
        case 1042: {
          return REJECTED_CREDENTIALS;
        }
        // Adding via the API needs a subscription account.
        case 1041: {
          return NEEDS_PREMIUM;
        }
        default: {
          return NO_ANSWER;
        }
      }
    }
  }
}
