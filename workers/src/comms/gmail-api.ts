/**
 * The Gmail REST calls this Worker makes, and nothing else.
 *
 * A thin client rather than a generated SDK: four endpoints are read, a handful of fields on each,
 * and the whole surface fits on a page. Bundling `googleapis` to reach it would cost more than the
 * code it replaces and drag Node built-ins into a runtime that has none.
 *
 * Two design points carry the rest of the module.
 *
 * The wire shapes below name ONLY the fields the poller reads. Gmail's message resource is large
 * and mostly irrelevant here, and a type that claims more than it uses invites the next reader to
 * trust fields nobody has ever seen arrive. Everything optional is optional because Gmail really
 * does omit it — a message with no `payload`, a part with no `body.data`.
 *
 * Failures are RETURNED, never thrown, and split into two kinds because the poller does two
 * different things with them. `rejected` means the credential will not work again without a human
 * (a revoked token, a scope the consent screen never granted) — the account is dead, not quiet, and
 * retrying costs a request per tick forever. `transport` means try again: a rate limit, a 5xx, a
 * socket that closed. The status rides along so the one caller that cares about a specific code —
 * the history walk, which reads 404 as "your cursor aged out" — can ask without re-parsing prose.
 */

/** `https://gmail.googleapis.com/gmail/v1/users/me` — every call below hangs off this. */
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * The most message ids one poll will collect. A first run over a busy week, or a re-seed after a
 * long outage, is otherwise unbounded — and every id past this one becomes a message fetch and a
 * model call.
 *
 * The overflow is NOT lost, but the cursor must never simply advance to the mailbox's current
 * head when this cap is hit — that head is "now", and everything still unlisted below it would
 * never be looked at again. Both listers below report `truncated: true` when they stopped early
 * so `planFetch` in `gmail.ts` can hold the cursor at a position that still covers the unread
 * remainder instead. See that module's doc comment for how each caller resumes.
 *
 * The value is set by the Workers **subrequest budget**, not by Gmail: the runtime allows 50
 * outbound fetches per invocation on the Free plan, and one poll spends roughly `7 + 2N` across
 * both accounts (token, profile, account upsert, the listing, N message reads, the batch insert,
 * the newsletter shelve and the poll stamp). At 15 that is ~44 — inside 50 with room to spare,
 * and a backlog simply drains over consecutive ticks, which is the whole point of the cap. Raise
 * it only alongside that arithmetic; exceeding the budget throws mid-poll, which stores nothing
 * and leaves the cursor unmoved, so the next tick repeats the same doomed read forever.
 */
export const MAX_MESSAGE_IDS = 15;

/** How much of a failing response body is kept. Enough to identify it, not enough to fill a log. */
const MAX_DETAIL_CHARS = 300;

/** Bounds one Gmail call, mirroring `classifier.ts`'s `REQUEST_TIMEOUT_MS` and for the same
 *  reason: a hung connection must not be able to run a cron tick past its cadence. A timeout
 *  aborts the `fetch`, which throws — the same `catch` that handles a dropped connection turns
 *  that into a `transport` failure, never a content one, so the poller retries it next tick. */
export const GMAIL_REQUEST_TIMEOUT_MS = 10_000;

/** One RFC822 header as Gmail hands it over. */
export interface GmailHeader {
  name: string;
  value: string;
}

/**
 * One MIME node. Gmail nests these: a `multipart/*` node carries `parts` and no body of its own,
 * a leaf carries `body.data` (base64url) and no parts, and an attachment carries a `filename`.
 */
export interface GmailPayload {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: GmailHeader[] | undefined;
  body?: { size?: number | undefined; data?: string | undefined } | undefined;
  parts?: GmailPayload[] | undefined;
}

/** A message as `messages.get?format=full` returns it, narrowed to what the poller reads. */
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[] | undefined;
  /** Milliseconds since the epoch, as a string. The time the message ARRIVED, not the poll time. */
  internalDate?: string | undefined;
  payload?: GmailPayload | undefined;
}

/** Who the token belongs to, and where the mailbox's history stands right now. */
export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

/**
 * A history walk's outcome. `expired: true` is not an error: a historyId is good for about a week,
 * and an account that was not polled for longer gets a re-seed rather than a red dot.
 *
 * `historyId` means two different things depending on `truncated`, and callers must not confuse
 * them: when the walk was NOT truncated it is Gmail's own top-level field — the mailbox's current
 * head, safe to resume from because there is nothing left unread below it. When it WAS truncated
 * it is instead the `id` of the last history record this walk fully consumed before it had to
 * stop — the one position that is actually safe to resume from, since the mailbox's current head
 * would skip every record still sitting between that point and here.
 */
export type GmailHistory =
  | { expired: true }
  | {
      expired: false;
      messageIds: string[];
      /** Where the next walk should resume from — see the field-level doc above. */
      historyId?: string | undefined;
      /** True when more history existed beyond the id cap and had to be left for next time. */
      truncated: boolean;
    };

/** Why a call did not produce a value, and whether a human has to do something about it. */
export interface GmailFailure {
  reason: 'rejected' | 'transport';
  detail: string;
  status?: number | undefined;
}

/** Either the value, or the reason there isn't one. Nothing in this module throws. */
export type GmailResult<T> = { ok: true; value: T } | ({ ok: false } & GmailFailure);

/** Message ids matching a search, and whether the id cap cut the listing short. */
export interface GmailMessageList {
  ids: string[];
  /** True when more ids existed beyond `MAX_MESSAGE_IDS` and had to be left for next time. */
  truncated: boolean;
  /**
   * Gmail's own resumption point for this EXACT listing (same `q`), forwarded whenever the LAST
   * page fetched carried one — i.e. whenever Gmail itself said there was another page, whether or
   * not our own cap was also why `truncated` is true. `undefined` only when the last page fetched
   * had no `nextPageToken` at all (nothing more exists, or the pathological case of a single
   * response handing back more ids than the `maxResults` we sent — see `MAX_MESSAGE_IDS`).
   *
   * This is what lets a caller resume the identical listing precisely, independent of the search
   * date's whole-SECOND granularity — see `gmail.ts`'s `finalizeListingCursor` for why that
   * independence is load-bearing: date narrowing alone cannot escape a tie where more matches
   * share one trailing second than fit under the cap.
   */
  pageToken?: string | undefined;
}

/** The four calls the poller makes, bound to one access token. */
export interface GmailClient {
  /** Whose mailbox this is, and its current historyId — the first-run cursor seed. */
  getProfile(): Promise<GmailResult<GmailProfile>>;
  /** Message ids matching a Gmail search query, paged to exhaustion or the id cap. */
  listMessageIds(options?: {
    q?: string | undefined;
    pageToken?: string | undefined;
  }): Promise<GmailResult<GmailMessageList>>;
  /** What arrived since `startHistoryId`, or word that the cursor aged out. */
  listHistory(options: {
    startHistoryId: string;
    pageToken?: string | undefined;
  }): Promise<GmailResult<GmailHistory>>;
  /** One whole message, headers and MIME tree included. */
  getMessage(id: string): Promise<GmailResult<GmailMessage>>;
}

/** `messages.list` as Gmail returns it. */
interface ListResponse {
  messages?: { id: string }[] | undefined;
  nextPageToken?: string | undefined;
}

/**
 * `history.list` as Gmail returns it. `messagesAdded` is the only record type asked for.
 *
 * Each record's own `id` is the historyId of that specific change — distinct from the response's
 * top-level `historyId`, which names the mailbox's current head regardless of how far the walk
 * actually got. A truncated walk resumes from a record's `id`, never from the top-level one.
 */
interface HistoryResponse {
  history?:
    | { id?: string | undefined; messagesAdded?: { message: { id: string } }[] | undefined }[]
    | undefined;
  historyId?: string | undefined;
  nextPageToken?: string | undefined;
}

/** Whatever was thrown by `fetch` itself, as a line worth recording. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Which kind of failure a status code is.
 *
 * 401 and 403 are both `rejected`, and 403 is the one worth naming: it is what Gmail answers when
 * the token is perfectly valid and the consent never covered `gmail.readonly`. That reads as an
 * auth problem a human must fix, not as something a retry will resolve — which is exactly what
 * `rejected` means.
 */
function reasonFor(status: number): 'rejected' | 'transport' {
  return status === 401 || status === 403 ? 'rejected' : 'transport';
}

/** Build a client bound to one access token. The token is never logged, here or by any caller. */
export function gmailClient(token: string): GmailClient {
  async function request<T>(path: string, params: Record<string, string>): Promise<GmailResult<T>> {
    const url = new URL(`${GMAIL_API_BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(GMAIL_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, reason: 'transport', detail: describe(error) };
    }

    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        reason: reasonFor(response.status),
        detail: `${String(response.status)} ${detail.slice(0, MAX_DETAIL_CHARS)}`,
        status: response.status,
      };
    }

    return { ok: true, value: await response.json<T>() };
  }

  return {
    getProfile() {
      return request<GmailProfile>('profile', {});
    },

    async listMessageIds(options = {}) {
      const ids: string[] = [];
      let pageToken = options.pageToken;

      // Sequential by necessity: each page's token is only known once the previous one lands.
      do {
        // Request only what's still missing from the cap, NEVER a fixed `MAX_MESSAGE_IDS` on
        // every page. Gmail's own docs: messages.list MAY return a page shorter than `maxResults`
        // even when more results exist (documented, and common under load) — so a fixed request
        // size lets `ids.length` overshoot the cap mid-loop (page 1 comes back short, page 2 comes
        // back full), and the slice below would silently drop the overshoot tail while forwarding
        // a `pageToken` that points PAST it, losing those ids for good. Clamping the request to
        // the remaining budget makes that overshoot structurally impossible: no page can ever hand
        // back more than we still have room to keep, so `pageToken` always lands exactly on the
        // next unread id. The loop only re-enters with `ids.length < MAX_MESSAGE_IDS` (the `while`
        // below), so this is always requesting between 1 and `MAX_MESSAGE_IDS` — never 0.
        const params: Record<string, string> = {
          maxResults: String(MAX_MESSAGE_IDS - ids.length),
        };
        if (options.q !== undefined) params['q'] = options.q;
        if (pageToken !== undefined) params['pageToken'] = pageToken;

        const page = await request<ListResponse>('messages', params);
        if (!page.ok) return page;

        for (const message of page.value.messages ?? []) ids.push(message.id);
        pageToken = page.value.nextPageToken;
      } while (pageToken !== undefined && ids.length < MAX_MESSAGE_IDS);

      // Truncated whenever there is more we did not keep. Normally that's `pageToken` surviving
      // the loop — Gmail itself said there was another page. `ids.length > MAX_MESSAGE_IDS` is
      // now a defensive fallback rather than a real path: with the per-page request above capped
      // to the remaining budget, no single page we asked for should ever be able to push the
      // running total past the cap on its own — the one way it still could is a single response
      // handing back MORE ids than the `maxResults` we sent, which would itself be Gmail violating
      // the contract `maxResults` documents (see `MAX_MESSAGE_IDS`). Either way the caller must
      // not treat this as "everything since the cursor" — see `planFetch` in gmail.ts for how it
      // holds its ground instead.
      const truncated = pageToken !== undefined || ids.length > MAX_MESSAGE_IDS;
      // `pageToken` here is exactly Gmail's own answer for "what's next" — forwarded as-is so a
      // caller resuming this listing can skip straight past everything already read.
      return { ok: true, value: { ids: ids.slice(0, MAX_MESSAGE_IDS), truncated, pageToken } };
    },

    async listHistory(options) {
      const ids = new Set<string>();
      let pageToken = options.pageToken;
      let mailboxHistoryId: string | undefined;
      // The last record fully folded into `ids` — the only position a truncated walk can safely
      // resume from. Gmail's own `id` on that record IS the historyId a follow-up `startHistoryId`
      // takes, so no extra bookkeeping (a page token, a timestamp) is needed to resume it.
      let lastRecordId: string | undefined;
      let truncated = false;

      do {
        const params: Record<string, string> = {
          startHistoryId: options.startHistoryId,
          historyTypes: 'messageAdded',
          maxResults: String(MAX_MESSAGE_IDS),
        };
        if (pageToken !== undefined) params['pageToken'] = pageToken;

        const page = await request<HistoryResponse>('history', params);
        if (!page.ok) {
          // A historyId is good for about a week. Past that Gmail answers 404 rather than
          // handing back a partial list, and the poller re-seeds from a date instead.
          if (page.status === 404) return { ok: true, value: { expired: true } };
          return page;
        }

        // Whole records only: a record's ids are never split across "kept" and "left for next
        // time", because splitting one would mean resuming from a position (mid-record) Gmail
        // has no `startHistoryId` for, silently dropping the un-kept half forever.
        for (const record of page.value.history ?? []) {
          const merged = new Set(ids);
          for (const added of record.messagesAdded ?? []) merged.add(added.message.id);
          if (merged.size > MAX_MESSAGE_IDS) {
            truncated = true;
            break;
          }
          for (const id of merged) ids.add(id);
          if (record.id !== undefined) lastRecordId = record.id;
        }
        if (truncated) break;

        mailboxHistoryId = page.value.historyId ?? mailboxHistoryId;
        pageToken = page.value.nextPageToken;
      } while (pageToken !== undefined && ids.size < MAX_MESSAGE_IDS);

      // Reaching the cap exactly at a page boundary, with more still waiting on the next page,
      // is truncation too even though no record above had to be rejected.
      if (!truncated && pageToken !== undefined) truncated = true;

      return {
        ok: true,
        value: {
          expired: false,
          messageIds: [...ids],
          // Gmail's top-level `historyId` is the mailbox's head, safe only when nothing was left
          // behind. A truncated walk instead reports the last record it actually consumed —
          // `undefined` only in the pathological case of a single record alone exceeding the cap,
          // where no safe resume point exists at all and the caller holds its cursor unchanged.
          historyId: truncated ? lastRecordId : mailboxHistoryId,
          truncated,
        },
      };
    },

    getMessage(id) {
      return request<GmailMessage>(`messages/${encodeURIComponent(id)}`, { format: 'full' });
    },
  };
}
