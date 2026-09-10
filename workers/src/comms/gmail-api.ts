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
 * model call. The overflow is not lost: the cursor only advances past what was ingested, so the
 * next tick picks up where this one stopped.
 */
export const MAX_MESSAGE_IDS = 500;

/** How much of a failing response body is kept. Enough to identify it, not enough to fill a log. */
const MAX_DETAIL_CHARS = 300;

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
 */
export type GmailHistory =
  | { expired: true }
  | {
      expired: false;
      messageIds: string[];
      /** Where the mailbox stands after this walk — the cursor the next poll resumes from. */
      historyId?: string | undefined;
    };

/** Why a call did not produce a value, and whether a human has to do something about it. */
export interface GmailFailure {
  reason: 'rejected' | 'transport';
  detail: string;
  status?: number | undefined;
}

/** Either the value, or the reason there isn't one. Nothing in this module throws. */
export type GmailResult<T> = { ok: true; value: T } | ({ ok: false } & GmailFailure);

/** The four calls the poller makes, bound to one access token. */
export interface GmailClient {
  /** Whose mailbox this is, and its current historyId — the first-run cursor seed. */
  getProfile(): Promise<GmailResult<GmailProfile>>;
  /** Message ids matching a Gmail search query, paged to exhaustion or the id cap. */
  listMessageIds(options?: {
    q?: string | undefined;
    pageToken?: string | undefined;
  }): Promise<GmailResult<string[]>>;
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

/** `history.list` as Gmail returns it. `messagesAdded` is the only record type asked for. */
interface HistoryResponse {
  history?: { messagesAdded?: { message: { id: string } }[] | undefined }[] | undefined;
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
        const params: Record<string, string> = { maxResults: String(MAX_MESSAGE_IDS) };
        if (options.q !== undefined) params['q'] = options.q;
        if (pageToken !== undefined) params['pageToken'] = pageToken;

        const page = await request<ListResponse>('messages', params);
        if (!page.ok) return page;

        for (const message of page.value.messages ?? []) ids.push(message.id);
        pageToken = page.value.nextPageToken;
      } while (pageToken !== undefined && ids.length < MAX_MESSAGE_IDS);

      return { ok: true, value: ids.slice(0, MAX_MESSAGE_IDS) };
    },

    async listHistory(options) {
      const ids: string[] = [];
      let pageToken = options.pageToken;
      let historyId: string | undefined;

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

        for (const record of page.value.history ?? []) {
          for (const added of record.messagesAdded ?? []) ids.push(added.message.id);
        }
        historyId = page.value.historyId ?? historyId;
        pageToken = page.value.nextPageToken;
      } while (pageToken !== undefined && ids.length < MAX_MESSAGE_IDS);

      // One message can be added, labelled and moved inside a single walk, arriving once per
      // record. The cursor is a position and the ids are an identity set, so dedupe here rather
      // than fetching the same message three times.
      return {
        ok: true,
        value: {
          expired: false,
          messageIds: [...new Set(ids)].slice(0, MAX_MESSAGE_IDS),
          historyId,
        },
      };
    },

    getMessage(id) {
      return request<GmailMessage>(`messages/${encodeURIComponent(id)}`, { format: 'full' });
    },
  };
}
