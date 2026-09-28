/**
 * Instapaper's Full API, as much of it as the Reader's To Reader leg uses: list the owner's
 * folders, list one folder's bookmarks, read a bookmark's text, and archive it.
 *
 * Ported from the knowledge repo's `scripts/lib/instapaper.ts` (the To Wiki command's client),
 * with `archive` added and `move` dropped — the Reader takes a bookmark out of To Reader by
 * archiving it, never by moving it to another folder. The workspaces share no package, so this is
 * a copy on purpose; two deployables coupled through one file would have to change together.
 * Two things differ from the source: this package bans the `null` literal, so a bookmark with no
 * text reads `undefined`; and every call goes through the global `fetch`, which the tests stub,
 * as every other client in this Worker does.
 *
 * Every call is a signed `POST` with a form body. A call Instapaper answered resolves; one it
 * refused, or that never reached it, throws an {@link InstapaperError} whose message names the
 * call, the kind and the code — never a header, a request body, a response body or a secret.
 */
import { type SigningMoment, newSigningMoment, signRequest } from './oauth';
import type {
  InstapaperApi,
  InstapaperBookmark,
  InstapaperCredentials,
  InstapaperEnv,
  InstapaperErrorKind,
  InstapaperFolder,
} from './types';

export const INSTAPAPER_API_URL = 'https://www.instapaper.com';

/**
 * How long one call may take, body included. A folder listing and an article's text are both
 * small; twenty seconds is far past a healthy answer and still short against the tick's own
 * eight-minute budget.
 */
export const INSTAPAPER_TIMEOUT_MS = 20_000;

/** get_text's "error generating text": Instapaper couldn't make a text view of the page. */
export const NO_TEXT_CODE = 1550;

/** "Invalid or missing bookmark_id" — on archive, the owner deleted the bookmark meanwhile. */
export const NO_SUCH_BOOKMARK_CODE = 1241;

/**
 * API 1.1 where the knowledge client has run it: `bookmarks/list` there answers with its
 * highlights as a separate array. `archive` is on API 1, as `bookmarks/add` is for the Send route.
 */
const PATHS = {
  listFolders: '/api/1.1/folders/list',
  listBookmarks: '/api/1.1/bookmarks/list',
  getText: '/api/1.1/bookmarks/get_text',
  archive: '/api/1/bookmarks/archive',
} as const;

/** The 1040/1041/1042 codes that mean something specific, regardless of HTTP status. */
const KIND_BY_CODE: ReadonlyMap<number, InstapaperErrorKind> = new Map([
  [1042, 'credentials'],
  [1040, 'rate-limited'],
  [1041, 'premium'],
]);

/** A failed call. Its message names the call, the kind, and the code; never a header, a body, or a secret. */
export class InstapaperError extends Error {
  readonly kind: InstapaperErrorKind;
  readonly code: number | undefined;

  constructor(call: string, kind: InstapaperErrorKind, code?: number, detail?: string) {
    const extra = [code === undefined ? '' : `error ${String(code)}`, detail ?? ''].filter(
      (part) => part !== '',
    );
    super(`${call}: ${kind}${extra.length > 0 ? ` (${extra.join(', ')})` : ''}`);
    this.name = 'InstapaperError';
    this.kind = kind;
    this.code = code;
  }
}

/** A blank value is an unset one, so a secret set to "" reads as missing rather than as "". */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The four values from the env, trimmed — or `undefined` when any is missing, which turns the leg off. */
export function instapaperCredentials(env: InstapaperEnv): InstapaperCredentials | undefined {
  const consumerKey = envValue(env.INSTAPAPER_CONSUMER_KEY);
  const consumerSecret = envValue(env.INSTAPAPER_CONSUMER_SECRET);
  const token = envValue(env.INSTAPAPER_ACCESS_TOKEN);
  const tokenSecret = envValue(env.INSTAPAPER_ACCESS_TOKEN_SECRET);
  if (consumerKey === undefined || consumerSecret === undefined) return undefined;
  if (token === undefined || tokenSecret === undefined) return undefined;
  return { consumerKey, consumerSecret, token, tokenSecret };
}

/** One JSON object Instapaper's answers are built from — a bookmark, a folder, an error, … */
type Item = Record<string, unknown>;

function isItem(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `JSON.parse`, without throwing: `ok: false` for a body that isn't JSON at all. */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** A parsed JSON value as a list of objects: itself when it's an array, else a lone item. */
function toItems(value: unknown): Item[] {
  if (Array.isArray(value)) return value.filter((entry) => isItem(entry));
  return isItem(value) ? [value] : [];
}

/** A finite number from a JSON number or a numeric string; `undefined` for anything else. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Instapaper's error items are `{"type":"error","error_code":…}`, inside an array or bare. */
function errorItem(items: Item[]): Item | undefined {
  return items.find((item) => item['type'] === 'error');
}

function parseFolder(item: Item): InstapaperFolder | undefined {
  const folderId = toNumber(item['folder_id']);
  const title = item['title'];
  if (folderId === undefined || typeof title !== 'string') return undefined;
  return { folderId, title };
}

function parseBookmark(item: Item): InstapaperBookmark | undefined {
  const bookmarkId = toNumber(item['bookmark_id']);
  if (bookmarkId === undefined) return undefined;
  return {
    bookmarkId,
    url: typeof item['url'] === 'string' ? item['url'] : '',
    title: typeof item['title'] === 'string' ? item['title'] : '',
    time: toNumber(item['time']) ?? 0,
  };
}

/**
 * `bookmarks/list`'s bookmark items, from either shape: API 1.1's object (`{bookmarks: […],
 * highlights: […]}`) or the older flat array of typed items. `undefined` when it is neither.
 */
function bookmarkItems(value: unknown): Item[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Item => isItem(entry) && entry['type'] === 'bookmark');
  }
  if (isItem(value) && Array.isArray(value['bookmarks'])) {
    return value['bookmarks'].filter((entry) => isItem(entry));
  }
  return undefined;
}

/** `/api/1.1/bookmarks/list` → `bookmarks/list`, the label an `InstapaperError` names. */
function callLabel(path: string): string {
  return path.replace(/^\/api\/1(?:\.1)?\//, '');
}

/** Why one answer failed, or `undefined` when it didn't. `items` is absent for a non-JSON body. */
function failure(call: string, status: number, items?: Item[]): InstapaperError | undefined {
  const error = items === undefined ? undefined : errorItem(items);
  const code = error === undefined ? undefined : toNumber(error['error_code']);
  const mapped = code === undefined ? undefined : KIND_BY_CODE.get(code);
  if (mapped !== undefined) return new InstapaperError(call, mapped, code);
  if (status === 401 || status === 403) return new InstapaperError(call, 'credentials', code);
  const nonOk = status < 200 || status >= 300;
  if (error !== undefined || nonOk) {
    const detail = code === undefined && nonOk ? `HTTP ${String(status)}` : undefined;
    return new InstapaperError(call, 'unavailable', code, detail);
  }
  return undefined;
}

export interface InstapaperClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected so a test's nonce and timestamp are fixed. */
  moment?: () => SigningMoment;
}

/** {@link InstapaperApi} over Instapaper's Full API, OAuth 1.0a signed. */
export function instapaperClient(
  credentials: InstapaperCredentials,
  options: InstapaperClientOptions = {},
): InstapaperApi {
  const baseUrl = options.baseUrl ?? INSTAPAPER_API_URL;
  const timeoutMs = options.timeoutMs ?? INSTAPAPER_TIMEOUT_MS;
  const moment = options.moment ?? newSigningMoment;

  /** One signed `POST`. Throws only for a call that never got an answer. */
  async function post(
    path: string,
    params: Record<string, string>,
  ): Promise<{ status: number; text: string }> {
    const url = `${baseUrl}${path}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: signRequest('POST', url, params, credentials, moment()),
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Read inside the try: the timeout also covers the body, and a body cut off mid-read is
      // unavailable too.
      return { status: response.status, text: await response.text() };
    } catch (error) {
      // Never the thrown error's own message: it could echo request data back into a log.
      const name = (error as { name?: unknown } | undefined)?.name;
      const detail = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error';
      throw new InstapaperError(callLabel(path), 'unavailable', undefined, detail);
    }
  }

  /** A JSON call's items, or throws. A 2xx body that isn't JSON is Instapaper's own 503 case. */
  async function postJson(
    path: string,
    params: Record<string, string>,
    tolerate?: number,
  ): Promise<unknown> {
    const call = callLabel(path);
    const { status, text } = await post(path, params);
    const parsed = parseJson(text);
    if (!parsed.ok) {
      throw (
        failure(call, status) ?? new InstapaperError(call, 'unavailable', undefined, 'not JSON')
      );
    }
    const items = toItems(parsed.value);
    const error = errorItem(items);
    if (
      tolerate !== undefined &&
      error !== undefined &&
      toNumber(error['error_code']) === tolerate
    ) {
      return parsed.value;
    }
    const refused = failure(call, status, items);
    if (refused !== undefined) throw refused;
    return parsed.value;
  }

  return {
    async listFolders() {
      const folders: InstapaperFolder[] = [];
      for (const item of toItems(await postJson(PATHS.listFolders, {}))) {
        const folder = parseFolder(item);
        if (folder !== undefined) folders.push(folder);
      }
      return folders;
    },

    async listBookmarks(folderId) {
      const value = await postJson(PATHS.listBookmarks, {
        folder_id: String(folderId),
        limit: '500',
      });
      const items = bookmarkItems(value);
      if (items === undefined) {
        throw new InstapaperError(
          callLabel(PATHS.listBookmarks),
          'unavailable',
          undefined,
          'unexpected answer',
        );
      }
      const bookmarks: InstapaperBookmark[] = [];
      for (const item of items) {
        const bookmark = parseBookmark(item);
        if (bookmark !== undefined) bookmarks.push(bookmark);
      }
      return bookmarks;
    },

    /**
     * get_text answers success with HTML and failure with JSON, so a JSON body that isn't error
     * 1550 is never article text, even at 2xx — stored as text, it would be summarised for good.
     */
    async getText(bookmarkId) {
      const call = callLabel(PATHS.getText);
      const { status, text } = await post(PATHS.getText, { bookmark_id: String(bookmarkId) });
      const parsed = parseJson(text);
      if (parsed.ok) {
        const items = toItems(parsed.value);
        const error = errorItem(items);
        if (error !== undefined && toNumber(error['error_code']) === NO_TEXT_CODE) return;
        throw (
          failure(call, status, items) ??
          new InstapaperError(call, 'unavailable', undefined, 'unexpected answer')
        );
      }
      const refused = failure(call, status);
      if (refused !== undefined) throw refused;
      return text;
    },

    async archive(bookmarkId) {
      // A bookmark the owner deleted since the listing is as out of To Reader as an archived one.
      await postJson(PATHS.archive, { bookmark_id: String(bookmarkId) }, NO_SUCH_BOOKMARK_CODE);
    },
  };
}
