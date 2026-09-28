/**
 * The To Reader leg: articles the owner moves into an Instapaper folder named "To Reader" become
 * Reader posts, summarised by the same summariser and prompt as a newsletter.
 *
 * It is the last leg of the Reader's own five-minute tick rather than a job of its own, because
 * everything it needs after the text — the lease, the daily ceiling, the summariser and the
 * health row — already lives there. Newsletters go first: each is bound by the worklist's
 * seven-day horizon, while a bookmark waits in its folder for as long as it takes. So the leg only
 * ever fills the slots the tick's newsletters and retries left free, and on a capped day it makes
 * no Instapaper call at all — a bookmark's preparation takes it out of the folder, and one the
 * tick will not summarise today belongs in the folder, not in the list.
 *
 * Once taken, a bookmark is ARCHIVED in Instapaper: the Reader becomes the one undecided list, as
 * it already is for newsletters the owner's Gmail filter archives on arrival, and To Reader empties
 * itself. The Reader's Send verb moves that same bookmark back to Unread. This file's only other
 * write to Instapaper is none: the folder is found by its exact title and never created.
 *
 * Everything here that decides is pure — the site, the title, the order, the plan for one
 * bookmark — and `intakeBookmark` is the one piece that talks to Instapaper and the database, in
 * the same order a newsletter's intake keeps: read, INSERT (the claim and the floor), then the
 * archive, and only then the model.
 */
import { htmlToText, truncateAtCodePointBoundary } from '../comms/email-text';
import { InstapaperError } from '../instapaper/client';
import type { InstapaperApi, InstapaperBookmark } from '../instapaper/types';
import type { SupabaseEnv } from '../supabase';
import { READER_TEXT_CHARS } from './extract';
import { NO_READABLE_BODY } from './intake';
import { type BookmarkedPost, insertPost } from './store';

/** The folder the owner moves articles into, matched exactly — as To Wiki's folder is. */
export const TO_READER_FOLDER = 'To Reader';

/**
 * What an article with no linked publication and no site is attributed to — on the row's eyebrow
 * and on the model's `Publication:` line alike.
 */
export const INSTAPAPER_PUBLICATION = 'Instapaper';

/** The title of an article that has neither a title nor a site. */
export const UNTITLED_ARTICLE = 'Untitled';

/** The leg's health words for a folder that isn't there. Quoted into the Reader header's note. */
export const NO_FOLDER_ERROR = `there is no “${TO_READER_FOLDER}” folder in Instapaper`;

/** Each Instapaper failure, in the words the Reader header's note quotes to the owner. */
const FAILURE_WORDS: Record<InstapaperError['kind'], string> = {
  credentials: "Instapaper rejected alfred's credentials",
  premium: 'Instapaper says this needs a Premium account',
  'rate-limited': 'Instapaper is rate-limiting alfred',
  unavailable: "Instapaper didn't answer",
};

/**
 * The failure kinds that mean every later call this tick would fail the same way. A merely
 * `unavailable` archive is one bookmark's bad moment; these are Instapaper's standing answer.
 */
const LEG_STOPPING: ReadonlySet<InstapaperError['kind']> = new Set([
  'credentials',
  'premium',
  'rate-limited',
]);

/** A Substack app link: `open.substack.com/pub/<name>/…`. */
const SUBSTACK_APP_PATH = /^\/pub\/([^/]+)/;

/** The owner's words for a failure. Anything that isn't Instapaper's own is "didn't answer". */
export function instapaperFailureWords(error: unknown): string {
  return error instanceof InstapaperError ? FAILURE_WORDS[error.kind] : FAILURE_WORDS.unavailable;
}

/** Whether a failure should stop the leg's later bookmarks this tick. */
export function stopsTheLeg(error: unknown): boolean {
  return error instanceof InstapaperError && LEG_STOPPING.has(error.kind);
}

/** The URL, parsed, when it is `http`/`https` — the only kind a row may link to. */
function webUrl(url?: string): URL | undefined {
  const trimmed = url?.trim() ?? '';
  if (trimmed === '') return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The bookmark's URL when it is one a row may link to, else nothing. */
export function articleUrl(url?: string): string | undefined {
  return webUrl(url) === undefined ? undefined : url?.trim();
}

/**
 * The site an article is from, normalised once at intake so nothing downstream re-parses a URL:
 * the lower-cased host with a leading `www.` dropped, and a Substack app link read as the
 * publication's own `<name>.substack.com` — the domain discovery already stores for it, which is
 * what lets a later story link the article to the publication by site alone.
 */
export function siteOf(url?: string): string | undefined {
  const parsed = webUrl(url);
  if (parsed === undefined) return undefined;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'open.substack.com') {
    const name = SUBSTACK_APP_PATH.exec(parsed.pathname)?.[1];
    if (name !== undefined && name !== '') return `${name.toLowerCase()}.substack.com`;
  }
  return host === '' ? undefined : host;
}

/** The title an article is stored under: its bookmark's, else its site, else Untitled. */
export function articleTitle(title: string, site?: string): string {
  const collapsed = title.replaceAll(/\s+/g, ' ').trim();
  if (collapsed !== '') return collapsed;
  return site ?? UNTITLED_ARTICLE;
}

/**
 * Instapaper's text view reduced to the stored text: the same stripper a newsletter's HTML goes
 * through, cut at the same ceiling, with the words counted on what was kept.
 */
export function articleText(html: string): { text: string; word_count: number } {
  const text = truncateAtCodePointBoundary(htmlToText(html), READER_TEXT_CHARS);
  return { text, word_count: text.split(/\s+/).filter((token) => token !== '').length };
}

/**
 * The name the model is told an article is from, as the row's eyebrow shows it: the linked
 * publication's, else the site, else Instapaper. Nothing links an article yet; when something
 * does, a retry picks the name up from the roster the tick already reads.
 */
export function articlePublication(
  publicationId: string | undefined,
  site: string | undefined,
  roster: ReadonlyMap<string, string>,
): string {
  const linked = publicationId === undefined ? undefined : roster.get(publicationId);
  return linked ?? site ?? INSTAPAPER_PUBLICATION;
}

/**
 * The bookmarks this tick takes, oldest first — a backlog drains in the order it was saved —
 * and no more than the free slots. A tie falls to the lower id, so two ticks read one folder the
 * same way.
 */
export function takeOldest(
  bookmarks: readonly InstapaperBookmark[],
  slots: number,
): InstapaperBookmark[] {
  // Sorted in place, on the fresh copy: `toSorted` is not in this package's ES2022 lib.
  const oldestFirst = [...bookmarks];
  oldestFirst.sort((left, right) => left.time - right.time || left.bookmarkId - right.bookmarkId);
  return oldestFirst.slice(0, Math.max(0, slots));
}

/** What one listing found: the folder's size, and the bookmarks this tick takes. */
export type ToReaderListing =
  | { kind: 'listed'; listed: number; marks: InstapaperBookmark[] }
  | { kind: 'no-folder' };

/**
 * Find To Reader and list it. Throws the client's `InstapaperError` for the tick to stamp; a
 * missing folder is a value, because it is the owner's to fix and alfred never creates one.
 */
export async function listToReader(api: InstapaperApi, slots: number): Promise<ToReaderListing> {
  const folders = await api.listFolders();
  const folder = folders.find((candidate) => candidate.title === TO_READER_FOLDER);
  if (folder === undefined) return { kind: 'no-folder' };
  const bookmarks = await api.listBookmarks(folder.folderId);
  return { kind: 'listed', listed: bookmarks.length, marks: takeOldest(bookmarks, slots) };
}

/** What the tick does with one bookmark, before anything is fetched for it. */
export type BookmarkPlan =
  /** Capped: it stays in To Reader for a day the budget can summarise it. */
  | { kind: 'leave' }
  /** Already a post the owner archived in the Reader: back onto the list, and out of the folder. */
  | { kind: 'restore'; postId: string }
  /** Already a post on the list: only the folder is out of step. */
  | { kind: 'archive' }
  /** No post holds it: read its text and take it in. */
  | { kind: 'intake' };

/**
 * The plan for one bookmark, the first matching row winning. A post that holds the bookmark —
 * whichever source wrote it — means no new post: an article whose archive failed last tick, or a
 * newsletter the owner sent to Instapaper and has now moved into To Reader, returns to the list
 * with the summary it already has. The cap wins over all of it, because every other row starts
 * by taking the bookmark out of To Reader.
 */
export function planBookmark(existing: BookmarkedPost | undefined, capped: boolean): BookmarkPlan {
  if (capped) return { kind: 'leave' };
  if (existing === undefined) return { kind: 'intake' };
  return existing.archived ? { kind: 'restore', postId: existing.id } : { kind: 'archive' };
}

/** Archive a bookmark, and say what happened rather than throw — the post is already safe. */
export async function archiveBookmark(
  api: InstapaperApi,
  bookmarkId: number,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await api.archive(bookmarkId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/** What taking one bookmark in came to. The tick switches on `kind` and nothing else. */
export type BookmarkIntake =
  /** Stored and leased, archived or not: the model is next. */
  | {
      kind: 'ready';
      id: string;
      title: string;
      site: string | undefined;
      text: string;
      wordCount: number;
      archive: { ok: true } | { ok: false; error: unknown };
    }
  /** Stored as failed — Instapaper could make no text of it — and the archive attempted. */
  | { kind: 'filed'; archive: { ok: true } | { ok: false; error: unknown } }
  /** Another tick inserted it first, and archives it. */
  | { kind: 'conflict' }
  /** get_text failed: nothing was written, and the bookmark stays in To Reader. */
  | { kind: 'unread'; error: unknown };

/**
 * Take one bookmark in: its text, the INSERT, then the archive.
 *
 * The insert comes before the archive because the post is the floor: an archive that fails leaves
 * a post next tick's "already a post?" read finds and archives again, never an article that left
 * To Reader with no post behind it. A get_text failure writes nothing at all, so the bookmark is
 * still in the folder and still no post's — the next tick simply tries again. Throws only when the
 * database does.
 */
export async function intakeBookmark(
  env: SupabaseEnv,
  api: InstapaperApi,
  bookmark: InstapaperBookmark,
  now: Date,
): Promise<BookmarkIntake> {
  let html: string | undefined;
  try {
    html = await api.getText(bookmark.bookmarkId);
  } catch (error) {
    return { kind: 'unread', error };
  }

  const site = siteOf(bookmark.url);
  const title = articleTitle(bookmark.title, site);
  const { text, word_count: wordCount } =
    html === undefined ? { text: '', word_count: 0 } : articleText(html);
  const nowIso = now.toISOString();
  const readable = text !== '';

  const inserted = await insertPost(env, {
    source: 'instapaper',
    instapaper_bookmark_id: bookmark.bookmarkId,
    title,
    canonical_url: articleUrl(bookmark.url),
    site,
    received_at: nowIso,
    text,
    word_count: wordCount,
    html_extracted: readable,
    // An article Instapaper had no text for is filed in the same insert, as the newsletter floor
    // is: its title and link stay in the list, and no model call is spent reaching the same end.
    ...(readable
      ? { summary_state: 'pending' as const, summarizing_since: nowIso }
      : { summary_state: 'failed' as const, last_error: NO_READABLE_BODY }),
  });
  if (!inserted.inserted) return { kind: 'conflict' };

  const archive = await archiveBookmark(api, bookmark.bookmarkId);
  if (!readable) return { kind: 'filed', archive };
  return { kind: 'ready', id: inserted.id, title, site, text, wordCount, archive };
}
