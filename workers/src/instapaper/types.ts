/**
 * The shapes the Worker's Instapaper client moves around: its env bindings, what it reads back,
 * and the interface the Reader tick builds against — so the tick's tests can fake Instapaper
 * without faking a signed HTTP exchange.
 */
/**
 * The four OAuth 1.0a values, as Worker secrets named exactly as the Vercel env vars the Send
 * route signs with, and holding the same values. Optional because each is set by hand, once: a
 * deployment missing any of them runs without the To Reader leg at all.
 */
export interface InstapaperEnv {
  INSTAPAPER_CONSUMER_KEY?: string;
  INSTAPAPER_CONSUMER_SECRET?: string;
  INSTAPAPER_ACCESS_TOKEN?: string;
  INSTAPAPER_ACCESS_TOKEN_SECRET?: string;
}

/** The consumer pair and the access-token pair. A Full API token is bound to the key that issued it. */
export interface InstapaperCredentials {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/** One of the owner's own folders (never Unread, Starred or Archive, which have no id). */
export interface InstapaperFolder {
  folderId: number;
  title: string;
}

/** One bookmark in a folder, as much of it as the tick reads. */
export interface InstapaperBookmark {
  bookmarkId: number;
  /** As Instapaper has it; a private (emailed) bookmark's may be empty or not http(s). */
  url: string;
  title: string;
  /** When the bookmark was saved, in Unix seconds. */
  time: number;
}

/** The calls the Reader tick and the eval script make. `instapaperClient` implements it. */
export interface InstapaperApi {
  /** The owner's own folders. */
  listFolders(): Promise<InstapaperFolder[]>;
  /** Up to 500 bookmarks in a folder. Their highlights are To Wiki's business, and dropped. */
  listBookmarks(folderId: number): Promise<InstapaperBookmark[]>;
  /** The article's HTML as Instapaper's text view has it; `undefined` when it can't make any. */
  getText(bookmarkId: number): Promise<string | undefined>;
  /** Move a bookmark to Instapaper's Archive. A bookmark that no longer exists counts as done. */
  archive(bookmarkId: number): Promise<void>;
}

/**
 * Why a call failed:
 * - `credentials`: 401/403, or the app is suspended (1042).
 * - `rate-limited`: 1040.
 * - `premium`: the account needs Premium (1041).
 * - `unavailable`: any other error code, a non-2xx, a network failure or timeout, or a body that
 *   isn't what the call expects.
 */
export type InstapaperErrorKind = 'credentials' | 'rate-limited' | 'premium' | 'unavailable';
