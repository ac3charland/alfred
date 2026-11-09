/**
 * The feed leg: entries of the RSS and Atom feeds on the roster become Reader posts, summarised by
 * the same summariser and prompt as a newsletter, with the feed's own summary kind.
 *
 * A leg of the Reader's five-minute tick, as the To Reader leg is, for the same reason: the lease,
 * the daily ceiling and the summariser already live there. It runs after the newsletters and the
 * retries and before To Reader, only when the ceiling isn't spent, a slot is free and a feed is
 * due, and it polls at most ONE feed a tick — the most overdue — so twelve ticks an hour serve
 * twelve feeds at an hourly cadence. Its failures are the feed's: they are stamped on that feed's
 * roster row (its card shows them) and never enter the tick's `failures`, so one dead blog never
 * holds back the Reader's own health.
 *
 * Everything that decides is pure and lives in `feeds.ts`. This file is the part that talks to the
 * network and the database, in the order the other sources keep: read the feed, read which entries
 * are already posts, then per entry read its page (only for an excerpt) and INSERT — the claim
 * and the floor — before the model. A feed is stamped checked only once a poll has taken every new
 * entry, so a backlog bigger than the tick's free slots drains over the next ticks.
 */
import { htmlToText, truncateAtCodePointBoundary } from '../comms/email-text';
import type { SupabaseEnv } from '../supabase';
import { READER_HTML_CHARS, READER_TEXT_CHARS } from './extract';
import {
  type DatedEntry,
  FEED_ENTRY_LIMIT,
  FEED_HORIZON_MS,
  FEED_MAX_BYTES,
  type FeedRosterRow,
  entryDate,
  entryIdentity,
  isExcerpt,
  pageArticleHtml,
  parseFeed,
  planFeedEntries,
  wordCount,
} from './feeds';
import { NO_READABLE_BODY } from './intake';
import { JSON_NULL, fetchFeedEntryIds, insertPost, stampFeed } from './store';
import { UNTITLED_ARTICLE } from './to-reader';

/** Who alfred says it is to a blog's server. */
export const FEED_USER_AGENT = 'alfred-reader (+https://github.com/ac3charland/alfred)';

/** How long a feed or an entry page gets to answer. */
export const FEED_TIMEOUT_MS = 10_000;

/** A feed's failure, in the words its card quotes after "Couldn't read the feed: ". */
export const FEED_ERROR_WORDS = {
  status: (status: number): string => `it answered ${String(status)}`,
  noAnswer: "it didn't answer",
  notAFeed: "it isn't an RSS or Atom feed any more",
  tooLarge: "it's too large to read",
} as const;

/** The conditional-GET validators a feed's last drained poll stored. */
export interface FeedValidators {
  etag?: string | undefined;
  lastModified?: string | undefined;
}

/** What one feed GET came to. */
export type FeedResponse =
  | { kind: 'not-modified' }
  | { kind: 'ok'; body: string; validators: FeedValidators }
  | { kind: 'failed'; error: string };

/** The leg's two network reads, injectable so a test never reaches a real blog. */
export interface FeedHttp {
  getFeed: (url: string, validators: FeedValidators) => Promise<FeedResponse>;
  /** An entry page's HTML, or nothing when it can't be read — the excerpt stands in then. */
  getPage: (url: string) => Promise<string | undefined>;
}

/** The one `fetch` signature the leg calls. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Thrown by `readCapped` when a body passes its cap. */
class TooLargeError extends Error {}

/**
 * A response body as text, read no further than `maxBytes`: a feed or a page past it throws
 * rather than being held whole in the Worker's memory.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number.parseInt(response.headers.get('Content-Length') ?? '', 10);
  if (!Number.isNaN(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new TooLargeError();
  }
  if (response.body === null) return '';
  // The Workers types leave a body's chunks untyped; a fetch body's are always bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new TooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The leg's HTTP over `fetch` — a 10 s timeout, a size cap, and alfred's User-Agent. */
export function feedHttp(fetcher: Fetcher = (url, init) => fetch(url, init)): FeedHttp {
  return {
    async getFeed(url, validators) {
      const headers: Record<string, string> = {
        'User-Agent': FEED_USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      };
      if (validators.etag !== undefined) headers['If-None-Match'] = validators.etag;
      if (validators.lastModified !== undefined)
        headers['If-Modified-Since'] = validators.lastModified;
      try {
        const response = await fetcher(url, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        });
        if (response.status === 304) return { kind: 'not-modified' };
        if (!response.ok) {
          await response.body?.cancel();
          return { kind: 'failed', error: FEED_ERROR_WORDS.status(response.status) };
        }
        const body = await readCapped(response, FEED_MAX_BYTES);
        return {
          kind: 'ok',
          body,
          validators: {
            etag: response.headers.get('ETag') ?? undefined,
            lastModified: response.headers.get('Last-Modified') ?? undefined,
          },
        };
      } catch (error) {
        return {
          kind: 'failed',
          error:
            error instanceof TooLargeError ? FEED_ERROR_WORDS.tooLarge : FEED_ERROR_WORDS.noAnswer,
        };
      }
    },

    async getPage(url) {
      try {
        const response = await fetcher(url, {
          headers: { 'User-Agent': FEED_USER_AGENT, Accept: 'text/html' },
          redirect: 'follow',
          signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        return await readCapped(response, READER_HTML_CHARS);
      } catch {
        return;
      }
    },
  };
}

/** The feed this tick polls, as the roster read gave it. */
export type DueFeed = FeedRosterRow & {
  feed_url: string;
  feed_etag?: string | undefined;
  feed_last_modified?: string | undefined;
};

/** What a poll's opening came to: entries to take, or a feed already finished with this tick. */
export type FeedPoll =
  /** The poll found new entries; the leg stamps the feed once all of them are taken. */
  | { kind: 'polled'; entries: DatedEntry[]; drained: boolean; validators: FeedValidators }
  /** A 304: nothing new, and the feed is stamped checked. */
  | { kind: 'not-modified' }
  /** The feed couldn't be read; its error is stamped. */
  | { kind: 'failed'; error: string };

/** The stamp a fully drained poll writes: checked, read, and the validators to send next time. */
export function drainedStamp(now: Date, validators: FeedValidators): Record<string, unknown> {
  const nowIso = now.toISOString();
  return {
    feed_checked_at: nowIso,
    feed_last_success_at: nowIso,
    feed_etag: validators.etag ?? JSON_NULL,
    feed_last_modified: validators.lastModified ?? JSON_NULL,
  };
}

/**
 * Poll one feed: GET it (conditionally), parse it, and read which of its new entries are already
 * posts. A 304, a failure, and a poll that found nothing to take are stamped here and end the leg;
 * a poll with entries leaves the stamp to the tick, after the entries are taken. Throws only when
 * the database does.
 */
export async function openFeedPoll(
  env: SupabaseEnv,
  http: FeedHttp,
  feed: DueFeed,
  now: Date,
  slots: number,
): Promise<FeedPoll> {
  const nowIso = now.toISOString();
  const response = await http.getFeed(feed.feed_url, {
    etag: feed.feed_etag,
    lastModified: feed.feed_last_modified,
  });

  if (response.kind === 'not-modified') {
    await stampFeed(env, feed.id, { feed_checked_at: nowIso, feed_last_success_at: nowIso });
    return { kind: 'not-modified' };
  }

  const parsed = response.kind === 'ok' ? parseFeed(response.body, feed.feed_url) : undefined;
  if (response.kind === 'failed' || parsed === undefined) {
    const error = response.kind === 'failed' ? response.error : FEED_ERROR_WORDS.notAFeed;
    await stampFeed(env, feed.id, {
      feed_checked_at: nowIso,
      feed_last_error: error,
      feed_last_error_at: nowIso,
    });
    return { kind: 'failed', error };
  }

  const dated = await Promise.all(
    parsed.entries.slice(0, FEED_ENTRY_LIMIT).map(
      async (entry): Promise<DatedEntry> => ({
        ...entry,
        // The entry's own author, else the feed's.
        author: entry.author ?? parsed.author,
        identity: await entryIdentity(entry),
        date: entryDate(entry, now),
      }),
    ),
  );
  const inHorizon = dated.filter(
    (entry) => now.getTime() - entry.date.getTime() <= FEED_HORIZON_MS,
  );
  const existing = await fetchFeedEntryIds(
    env,
    feed.id,
    inHorizon.map((entry) => entry.identity),
  );
  const plan = planFeedEntries(inHorizon, existing, now, slots);

  if (plan.take.length === 0) {
    await stampFeed(env, feed.id, drainedStamp(now, response.validators));
  }
  return {
    kind: 'polled',
    entries: plan.take,
    drained: plan.drained,
    validators: response.validators,
  };
}

/** An entry's text and HTML as stored: the feed's body, or its page's article when that is longer. */
export interface EntryBody {
  text: string;
  wordCount: number;
  html: string | undefined;
}

/** HTML reduced to the stored text, cut at the stored-text ceiling. */
function storedText(html: string): string {
  return truncateAtCodePointBoundary(htmlToText(html), READER_TEXT_CHARS);
}

/**
 * The body a feed entry is stored with. A full-content entry is read from the feed alone; an
 * excerpt's page is fetched and its article kept when that is longer than the excerpt. A page that
 * can't be read leaves the excerpt — the floor (title and link) is never lost to it.
 */
export async function entryBody(http: FeedHttp, entry: DatedEntry): Promise<EntryBody> {
  let html = entry.html;
  let text = storedText(html);
  if (isExcerpt(entry) && entry.link !== undefined) {
    const page = await http.getPage(entry.link);
    if (page !== undefined) {
      const article = pageArticleHtml(page);
      const articleText = storedText(article);
      if (articleText.length > text.length) {
        html = article;
        text = articleText;
      }
    }
  }
  return {
    text,
    wordCount: wordCount(text),
    html: text === '' || html.length > READER_HTML_CHARS ? undefined : html,
  };
}

/** What taking one entry in came to. */
export type FeedEntryIntake =
  | { kind: 'ready'; id: string; title: string; body: EntryBody }
  /** Stored as failed: neither the feed nor the page had any text. */
  | { kind: 'filed' }
  /** Another tick inserted it first. */
  | { kind: 'conflict' };

/** An entry's title as stored: collapsed, else Untitled. */
export function entryTitle(entry: DatedEntry): string {
  const collapsed = entry.title.replaceAll(/\s+/g, ' ').trim();
  return collapsed === '' ? UNTITLED_ARTICLE : collapsed;
}

/**
 * Take one entry in: its body (and page), then the INSERT that is the claim. An entry with no text
 * is filed `failed` in the same insert, as a newsletter's and an article's are. Throws only when the
 * database does.
 */
export async function intakeFeedEntry(
  env: SupabaseEnv,
  http: FeedHttp,
  feedId: string,
  entry: DatedEntry,
  now: Date,
): Promise<FeedEntryIntake> {
  const body = await entryBody(http, entry);
  const readable = body.text !== '';
  const title = entryTitle(entry);
  const inserted = await insertPost(env, {
    source: 'feed',
    publication_id: feedId,
    feed_entry_id: entry.identity,
    title,
    author: entry.author,
    canonical_url: entry.link,
    received_at: entry.date.toISOString(),
    text: body.text,
    word_count: body.wordCount,
    html_extracted: readable,
    html: body.html,
    ...(readable
      ? { summary_state: 'pending' as const, summarizing_since: now.toISOString() }
      : { summary_state: 'failed' as const, last_error: NO_READABLE_BODY }),
  });
  if (!inserted.inserted) return { kind: 'conflict' };
  if (!readable) return { kind: 'filed' };
  return { kind: 'ready', id: inserted.id, title, body };
}
