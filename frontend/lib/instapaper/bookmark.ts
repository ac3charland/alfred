import 'server-only';

import { postWebUrl } from '@/lib/reader/open-link';

import type { InstapaperConfig } from './config';
import { textToHtml } from './content';
import { signRequest } from './oauth';

/**
 * Saving one Reader post to Instapaper through its Full API.
 *
 * A newsletter is saved with `POST /api/1/bookmarks/add`, carrying the post's own body as
 * `content`, so Instapaper parses the article out of the email the owner received — the same
 * thing its email-in feature does with a forwarded newsletter — instead of fetching the web page,
 * which for a paid post is the paywall's teaser. No tags and no folder: a sent post lands in
 * Unread like anything else the owner saves, and a tag is left for the owner to apply by hand as
 * an act of choosing.
 *
 * An article that came in through the Instapaper folder "To Reader" is already the owner's
 * bookmark — the Worker archived it when it took it in — so its send is `bookmarks/unarchive`:
 * the owner's own bookmark back at the top of Unread, with its progress and highlights, and no
 * body uploaded. Only when the owner has deleted that bookmark is it saved again, by URL.
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

/** "Invalid or missing bookmark_id": the owner deleted the bookmark in Instapaper. */
const NO_SUCH_BOOKMARK = 1241;

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

/** The refusal or failure an answer carries, or undefined when it carries none. */
function readFailure(
  status: number,
  items: readonly Record<string, unknown>[],
): Exclude<AddBookmarkOutcome, { kind: 'saved' }> | undefined {
  const error = items.find((item) => item['type'] === 'error');
  const code = typeof error?.['error_code'] === 'number' ? error['error_code'] : undefined;
  const refusal = code === undefined ? undefined : REFUSAL_BY_CODE.get(code);
  if (refusal !== undefined) return { kind: 'refused', refusal, code };
  if (status === 401 || status === 403) return { kind: 'refused', refusal: 'credentials', code };
  if (error !== undefined || status < 200 || status >= 300) return { kind: 'unavailable', code };
  return undefined;
}

/** Read Instapaper's answer into an outcome. */
function readAnswer(status: number, raw: string): AddBookmarkOutcome {
  const items = answerItems(raw);
  const failure = readFailure(status, items);
  if (failure !== undefined) return failure;

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
export function addBookmark(
  config: InstapaperConfig,
  params: Readonly<Record<string, string>>,
): Promise<AddBookmarkOutcome> {
  return postForm(config, '/api/1/bookmarks/add', params);
}

/**
 * The params for saving one Further reading link: the model's title for it as the title, its note
 * as the description (left out when blank), and the To Reader folder when one is given. No
 * `content` and no tags — Instapaper fetches the linked page itself, which is the point of
 * sending a link — and `resolve_final_url` stays at Instapaper's default, because the links are
 * often redirecting tracker URLs.
 */
export function buildLinkBookmarkParams(
  item: { url: string; title: string; note: string },
  folderId?: number,
): Record<string, string> {
  const params: Record<string, string> = { url: item.url, title: item.title };
  const note = item.note.trim();
  if (note !== '') params['description'] = note;
  if (folderId !== undefined) params['folder_id'] = String(folderId);
  return params;
}

/** What moving a bookmark back to Unread came to — a save's outcomes, or a bookmark that is gone. */
export type UnarchiveOutcome = AddBookmarkOutcome | { kind: 'gone' };

/**
 * Move one of the owner's own bookmarks from Instapaper's Archive back to the top of Unread.
 * Answers with the bookmark, like a save; `gone` when the owner has deleted it since.
 */
export async function unarchiveBookmark(
  config: InstapaperConfig,
  bookmarkId: number,
): Promise<UnarchiveOutcome> {
  const outcome = await postForm(config, '/api/1/bookmarks/unarchive', {
    bookmark_id: String(bookmarkId),
  });
  return outcome.kind === 'unavailable' && outcome.code === NO_SUCH_BOOKMARK
    ? { kind: 'gone' }
    : outcome;
}

/**
 * An article's send: its bookmark back to Unread, or — when the owner deleted that bookmark — a
 * new one saved by URL with no content, so Instapaper fetches the page as it did the first time.
 * The stored text is Instapaper's own text view, never a better body than the page; it is sent
 * only for a bookmark that never had a URL. Null when the bookmark is gone and there is nothing
 * to save in its place. The answer's bookmark id is the one the post holds from here on.
 */
export async function restoreOrResave(
  config: InstapaperConfig,
  post: BookmarkSource,
  bookmarkId: number,
): Promise<AddBookmarkOutcome | null> {
  const restored = await unarchiveBookmark(config, bookmarkId);
  if (restored.kind !== 'gone') return restored;

  const byUrl = postWebUrl(post) !== undefined;
  const params = buildBookmarkParams(byUrl ? { ...post, html: null, text: null } : post);
  return params === null ? null : addBookmark(config, params);
}

/** One signed form POST to Instapaper: its status and raw body, or null when it never answered. */
async function postSigned(
  config: InstapaperConfig,
  path: string,
  params: Readonly<Record<string, string>>,
): Promise<{ status: number; raw: string } | null> {
  const url = `${config.apiUrl}${path}`;
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
    return { status: response.status, raw: await response.text() };
  } catch {
    return null;
  }
}

/** One signed form POST to Instapaper, read as a bookmark's outcome. Never throws. */
async function postForm(
  config: InstapaperConfig,
  path: string,
  params: Readonly<Record<string, string>>,
): Promise<AddBookmarkOutcome> {
  const answer = await postSigned(config, path, params);
  return answer === null
    ? { kind: 'unavailable', code: undefined }
    : readAnswer(answer.status, answer.raw);
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

/** The folder Further reading links sent to the Reader land in, matched exactly by title. */
export const TO_READER_FOLDER = 'To Reader';

/** One of the owner's Instapaper folders. */
export interface InstapaperFolder {
  folderId: number;
  title: string;
}

/** What listing the owner's folders came to. */
export type ListFoldersOutcome =
  | { kind: 'listed'; folders: InstapaperFolder[] }
  | Exclude<AddBookmarkOutcome, { kind: 'saved' }>;

/** One folder out of the answer's items, or undefined for anything else (ids may be strings). */
function readFolder(item: Record<string, unknown>): InstapaperFolder | undefined {
  if (item['type'] !== 'folder' || typeof item['title'] !== 'string') return undefined;
  const raw = item['folder_id'];
  const folderId = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof folderId === 'number' && Number.isInteger(folderId)
    ? { folderId, title: item['title'] }
    : undefined;
}

function isJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The owner's folders, so a send to the Reader can find the id of "To Reader". Never throws: a
 * timeout, a network failure and every answer Instapaper can give come back as an outcome.
 */
export async function listFolders(config: InstapaperConfig): Promise<ListFoldersOutcome> {
  const answer = await postSigned(config, '/api/1.1/folders/list', {});
  if (answer === null) return { kind: 'unavailable', code: undefined };
  const items = answerItems(answer.raw);
  const failure = readFailure(answer.status, items);
  if (failure !== undefined) return failure;
  // A body that was not JSON reads as no items, which must not pass for an owner with no folders.
  if (items.length === 0 && !isJson(answer.raw)) return { kind: 'unavailable', code: undefined };
  return {
    kind: 'listed',
    folders: items.flatMap((item) => readFolder(item) ?? []),
  };
}

/**
 * How long a send keeps starting new saves. The route runs inside a serverless function whose own
 * limit is 30 s; stopping at 20 s leaves room for the in-flight save (it has its own
 * {@link TIMEOUT_MS}) and the write that records the marks, so a slow Instapaper costs the owner
 * some unsent links rather than the whole answer.
 */
export const SEND_DEADLINE_MS = 20_000;

/** What a run of link saves came to: the links Instapaper confirmed, and the ones it did not. */
export interface SendLinksResult {
  landed: string[];
  /** Failed, or never started because the deadline passed first. In the order given. */
  unsent: string[];
  /** The first save's failure, if any save failed — what the owner is told about the rest. */
  firstFailure: Exclude<AddBookmarkOutcome, { kind: 'saved' }> | undefined;
}

/**
 * Save Further reading links one after another, in the order given. One at a time, because
 * Instapaper rate-limits and because the order the owner ticked them in is the order they should
 * land in Unread. A failed save does not stop the rest — a refused link is about that link — but
 * no new save STARTS once {@link SEND_DEADLINE_MS} has passed since `startedAt`. `now` is
 * injectable so the deadline is testable without waiting. Never throws.
 */
export async function sendLinks(
  config: InstapaperConfig,
  items: readonly { url: string; title: string; note: string }[],
  options: { folderId?: number; startedAt: number; now?: () => number },
): Promise<SendLinksResult> {
  const now = options.now ?? Date.now;
  const result: SendLinksResult = { landed: [], unsent: [], firstFailure: undefined };
  for (const item of items) {
    if (now() - options.startedAt >= SEND_DEADLINE_MS) {
      result.unsent.push(item.url);
      continue;
    }
    const outcome = await addBookmark(config, buildLinkBookmarkParams(item, options.folderId));
    if (outcome.kind === 'saved') {
      result.landed.push(item.url);
    } else {
      result.unsent.push(item.url);
      result.firstFailure ??= outcome;
    }
  }
  return result;
}
