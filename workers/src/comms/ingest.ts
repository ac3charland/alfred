/**
 * `POST /comms/ingest` — the Mac daemon's only way into this database.
 *
 * The daemon holds no Supabase credential at all: it polls iMessage and an IMAP mailbox,
 * normalizes what it finds, and posts it here signed. This endpoint is the whole of what that
 * credential can do — write messages for its own accounts — so a laptop that goes missing carries
 * a write-only pipe rather than a key that can read the database.
 *
 * The request is verified BEFORE it is parsed, over the exact bytes that were signed, and the
 * signature covers a timestamp as well as the body: a bearer token replays forever and vouches
 * for nothing about what it arrived with, while a captured signature here is single-use and bound
 * to this exact payload. That is a narrow property, bought deliberately, because the traffic on
 * this endpoint includes other people's private words.
 *
 * The payload is validated by hand rather than with a schema library — this package carries no
 * runtime dependency but the Anthropic SDK, and the shape is small enough that the check reads as
 * the contract. A rejection names the field that failed, because a batch of fifty messages with
 * one bad row is otherwise a guessing game at the other end.
 *
 * A zero-message payload is a first-class request, not a degenerate one. The daemon coalesces its
 * liveness report to about once a minute whether or not anything arrived, and that report is the
 * only thing that separates a quiet Mac from a sleeping one.
 */
import { verifyTimestampedSignature } from '../hmac';
import { type SupabaseEnv } from '../supabase';
import { fetchMessageIdsBySourceIds } from './gmail-store';
import { isNewsletter } from './newsletter';
import {
  fetchPeople,
  ingestMessages,
  patchMessage,
  recordPollError,
  recordPollSuccess,
  upsertAccount,
} from './store';
import type { CommAccountKind, CommDirection, NormalizedMessage } from './types';

/** What the endpoint needs bound: the database, plus the secret it verifies against. */
export interface IngestEnv extends SupabaseEnv {
  COMMS_INGEST_HMAC_SECRET?: string;
}

/** The unix-second timestamp the signature is computed over, alongside the body. */
export const TIMESTAMP_HEADER = 'X-Alfred-Timestamp';

/** `sha256=<hex>` over `${timestamp}.${rawBody}`. */
export const SIGNATURE_HEADER = 'X-Alfred-Signature';

/** The payload version this endpoint speaks. A different one is refused, never guessed at. */
export const INGEST_VERSION = 1;

/** What is recorded when the daemon reports a failed poll but says nothing about why. */
export const UNEXPLAINED_FAILURE = 'the daemon reported a failed poll with no message';

/**
 * JSON's `null`, built rather than written because this package bans the literal in source. The
 * response needs a real null: the daemon reads `cursor` to decide whether it must seed from a
 * lookback window, and an absent key and a null are not the same answer to that question.
 */
const JSON_NULL: unknown = JSON.parse('null');

const json = (status: number, data: Record<string, unknown>): Response =>
  Response.json(data, { status, headers: { 'Content-Type': 'application/json' } });

/** The account the daemon claims, as it arrives on the wire. */
interface IngestAccount {
  key: string;
  kind: CommAccountKind;
  label: string;
  owner_handles: string[];
  expected_interval_seconds: number;
}

/** The liveness report that rides along with every payload, messages or not. */
interface IngestHeartbeat {
  ok: boolean;
  cursor: unknown;
  error: string | undefined;
}

/** One whole ingest request. */
/**
 * A message the daemon saw bulk-mail headers on. The daemon reports the header NAMES it found and
 * nothing more — it has no roster, so it cannot apply the filter; the Worker applies the same rule
 * here that the Gmail poller applies to its own mail.
 */
interface BulkCandidate {
  sourceId: string;
  senderHandle: string;
  direction: CommDirection;
  listHeaders: string[];
}

interface IngestPayload {
  account: IngestAccount;
  heartbeat: IngestHeartbeat;
  messages: NormalizedMessage[];
  bulk: BulkCandidate[];
}

// Non-empty in the TYPE, not just in fact: the reader below falls back to the first entry when a
// field is wrong, and a plain array would make that fallback possibly-undefined for no reason.
const ACCOUNT_KINDS: readonly [CommAccountKind, ...CommAccountKind[]] = [
  'gmail',
  'imap',
  'imessage',
];
const DIRECTIONS: readonly [CommDirection, ...CommDirection[]] = ['inbound', 'outbound'];

/**
 * Handle one ingest request. `now` is injected rather than read here so the replay window, the
 * heartbeat stamp and the drain all read the same instant, and so a test can hold it still.
 */
export async function handleIngest(request: Request, env: IngestEnv, now: Date): Promise<Response> {
  const secret = env.COMMS_INGEST_HMAC_SECRET;
  if (secret === undefined || secret === '') {
    // Nothing to verify against. Accepting would mean accepting anything, and the daemon needs to
    // be told that the deploy is missing a manual step rather than that its payload was bad.
    return json(503, { error: 'ingest is not configured' });
  }

  // The RAW body, before any parse — these are the exact bytes the signature covers.
  const rawBody = await request.text();
  const verified = await verifyTimestampedSignature(
    secret,
    rawBody,
    request.headers.get(TIMESTAMP_HEADER) ?? undefined,
    request.headers.get(SIGNATURE_HEADER) ?? undefined,
    now,
  );
  if (!verified.ok) {
    return json(401, { error: refusal(verified.reason) });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'body must be valid JSON' });
  }

  const parsed = parsePayload(body);
  if ('error' in parsed) return json(400, { error: parsed.error });
  const { account, heartbeat, messages, bulk } = parsed.payload;

  try {
    // The account registers itself, every time. Only the columns a poller owns are sent, so this
    // cannot disturb the cursor or the health the calls below are about to write.
    const stored = await upsertAccount(env, {
      key: account.key,
      kind: account.kind,
      label: account.label,
      home: 'daemon',
      owner_handles: account.owner_handles,
      expected_interval_seconds: account.expected_interval_seconds,
    });

    await recordHeartbeat(env, stored.id, heartbeat, now);

    // Independent of the heartbeat on purpose: a poll that read some messages and then broke has
    // both a failure to report and rows worth keeping.
    const result = await ingestMessages(env, stored, messages, now);
    await shelveBulkMail(env, stored.id, bulk, now);

    return json(200, {
      accepted: result.accepted,
      duplicates: result.duplicates,
      drained: result.drained,
      cursor: currentCursor(heartbeat, stored.cursor),
      last_seen_at: heartbeat.ok ? now.toISOString() : (stored.last_seen_at ?? JSON_NULL),
    });
  } catch (error) {
    // The daemon must be able to tell "your payload was wrong" from "try again later": only the
    // second means keep the cursor where it is and re-send. The detail stays in the Worker's log
    // rather than travelling back over the wire.
    console.error('comms ingest failed:', error);
    return json(503, { error: 'ingest failed' });
  }
}

/**
 * Stamp the poll the daemon just reported. A success moves `last_seen_at` (and the cursor it
 * resumed from); a failure moves only the error, because the timestamp of the last SUCCESSFUL
 * poll is the one thing that separates a quiet source from a broken one.
 */
function recordHeartbeat(
  env: IngestEnv,
  accountId: string,
  heartbeat: IngestHeartbeat,
  now: Date,
): Promise<void> {
  if (heartbeat.ok) {
    return recordPollSuccess(env, accountId, { at: now, cursor: heartbeat.cursor });
  }
  return recordPollError(env, accountId, {
    at: now,
    error: heartbeat.error ?? UNEXPLAINED_FAILURE,
  });
}

/**
 * The newsletter filter, applied after the rows exist. Same rule as the Gmail poller: a genuine
 * list header from a sender who is not on the roster shelves the message as filtered, with no
 * verdict and no model call. The daemon only reports which bulk headers it saw; the roster lives
 * here, so the decision does too. Only inbound rows, and only rows nobody has judged yet — a
 * re-sent batch must not overwrite a tier the owner has since chosen.
 */
async function shelveBulkMail(
  env: IngestEnv,
  accountId: string,
  bulk: BulkCandidate[],
  now: Date,
): Promise<void> {
  // Strong signals first, with an empty roster: that decides whether the roster is worth reading
  // at all, since a batch with only weak headers (a lone Precedence) never touches the database.
  const headersOf = (entry: BulkCandidate): { name: string; value: string }[] =>
    entry.listHeaders.map((name) => ({ name, value: 'present' }));
  const candidates = bulk.filter(
    (entry) =>
      entry.direction === 'inbound' &&
      isNewsletter(headersOf(entry), {
        senderHandle: entry.senderHandle,
        rosterHandles: new Set(),
      }),
  );
  if (candidates.length === 0) return;

  const people = await fetchPeople(env);
  const rosterHandles = new Set(
    people.flatMap((person) =>
      person.handles
        .filter((handle) => handle.kind === 'email')
        .map((handle) => handle.handle.toLowerCase()),
    ),
  );

  const filtered = candidates.filter((entry) =>
    isNewsletter(headersOf(entry), { senderHandle: entry.senderHandle, rosterHandles }),
  );
  if (filtered.length === 0) return;

  const ids = await fetchMessageIdsBySourceIds(
    env,
    accountId,
    filtered.map((entry) => entry.sourceId),
  );
  for (const id of ids.values()) {
    await patchMessage(
      env,
      id,
      {
        tier: 'fyi',
        judged_by: 'filter',
        filtered_reason: 'newsletter',
        classified_at: now.toISOString(),
      },
      { onlyIfUnjudged: true },
    );
  }
}

/** What the 401 says, per reason. Three messages, because three different things went wrong. */
function refusal(reason: 'missing' | 'stale' | 'mismatch'): string {
  if (reason === 'missing') return 'missing signature';
  return reason === 'stale' ? 'stale timestamp' : 'invalid signature';
}

/**
 * The cursor as it now stands: what this request stored, or what was already there. A failed poll
 * stores none, and a successful poll that produced none leaves the stored one alone — so in both
 * cases the answer is the account's own.
 */
function currentCursor(heartbeat: IngestHeartbeat, stored: unknown): unknown {
  const current = heartbeat.ok && heartbeat.cursor !== undefined ? heartbeat.cursor : stored;
  return current === undefined ? JSON_NULL : current;
}

// ── Validation ───────────────────────────────────────────────────────────────
//
// A reader per object: each accessor either returns a usable value or records the first thing
// that was wrong and returns a placeholder. That keeps the field list readable as a list — the
// alternative, threading a result type through twenty fields, buries the contract in plumbing —
// and the caller checks `error` once before it trusts anything the reader built.

type Parsed<T> = { payload: T } | { error: string };

interface Reader {
  string(field: string): string;
  optionalString(field: string): string | undefined;
  boolean(field: string): boolean;
  positiveInteger(field: string): number;
  stringArray(field: string): string[];
  optionalStringArray(field: string): string[] | undefined;
  object(field: string): Record<string, unknown>;
  timestamp(field: string): string;
  oneOf<T extends string>(field: string, allowed: readonly T[]): T;
  raw(field: string): unknown;
  readonly error: string | undefined;
}

/**
 * True for JSON's `null` as well as an absent key. Loose `== undefined` on purpose: it is the one
 * comparison that catches both without writing the `null` literal this package bans.
 */
function isAbsent(value: unknown): boolean {
  return value == undefined;
}

/** A record, or undefined for anything else — including a bare `null`, whose typeof is 'object'. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (isAbsent(value) || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readerFor(record: Record<string, unknown>, path: string): Reader {
  let error: string | undefined;
  const fail = (field: string, expected: string): void => {
    error ??= `${path}${field} must be ${expected}`;
  };

  return {
    string(field) {
      const value = record[field];
      if (typeof value === 'string' && value !== '') return value;
      fail(field, 'a non-empty string');
      return '';
    },
    optionalString(field) {
      const value = record[field];
      if (isAbsent(value)) return;
      if (typeof value === 'string') return value;
      fail(field, 'a string when present');
      return;
    },
    boolean(field) {
      const value = record[field];
      if (typeof value === 'boolean') return value;
      fail(field, 'a boolean');
      return false;
    },
    positiveInteger(field) {
      const value = record[field];
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
      fail(field, 'a positive whole number');
      return 1;
    },
    stringArray(field) {
      const value = record[field];
      if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
        return value;
      }
      fail(field, 'an array of strings');
      return [];
    },
    optionalStringArray(field) {
      const value = record[field];
      if (isAbsent(value)) return;
      if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
        return value;
      }
      fail(field, 'an array of strings when present');
      return;
    },
    object(field) {
      const value = asRecord(record[field]);
      if (value !== undefined) return value;
      fail(field, 'an object');
      return {};
    },
    timestamp(field) {
      const value = record[field];
      if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
      fail(field, 'an ISO 8601 timestamp');
      return new Date(0).toISOString();
    },
    oneOf<T extends string>(field: string, allowed: readonly [T, ...T[]]): T {
      const value = record[field];
      if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
        return value as T;
      }
      fail(field, `one of ${allowed.join(', ')}`);
      return allowed[0];
    },
    raw(field) {
      const value = record[field];
      return isAbsent(value) ? undefined : value;
    },
    get error() {
      return error;
    },
  };
}

/** The body as a whole. The version is checked first: a payload we cannot read is not one to guess at. */
function parsePayload(body: unknown): Parsed<IngestPayload> {
  const root = asRecord(body);
  if (root === undefined) return { error: 'body must be a JSON object' };
  if (root['version'] !== INGEST_VERSION) return { error: 'version must be 1' };

  const top = readerFor(root, '');
  const accountRecord = top.object('account');
  const heartbeatRecord = top.object('heartbeat');
  if (top.error !== undefined) return { error: top.error };

  const account = readerFor(accountRecord, 'account.');
  const parsedAccount: IngestAccount = {
    key: account.string('key'),
    kind: account.oneOf('kind', ACCOUNT_KINDS),
    label: account.string('label'),
    owner_handles: account.stringArray('owner_handles'),
    expected_interval_seconds: account.positiveInteger('expected_interval_seconds'),
  };
  if (account.error !== undefined) return { error: account.error };

  const heartbeat = readerFor(heartbeatRecord, 'heartbeat.');
  const parsedHeartbeat: IngestHeartbeat = {
    ok: heartbeat.boolean('ok'),
    cursor: heartbeat.raw('cursor'),
    error: heartbeat.optionalString('error'),
  };
  if (heartbeat.error !== undefined) return { error: heartbeat.error };

  const rawMessages = root['messages'];
  if (!Array.isArray(rawMessages)) return { error: 'messages must be an array' };

  const messages: NormalizedMessage[] = [];
  const bulk: BulkCandidate[] = [];
  for (const [index, raw] of rawMessages.entries()) {
    const parsed = parseMessage(raw, `messages[${String(index)}].`);
    if ('error' in parsed) return { error: parsed.error };
    messages.push(parsed.payload.message);
    if (parsed.payload.listHeaders.length > 0) {
      bulk.push({
        sourceId: parsed.payload.message.source_id,
        senderHandle: parsed.payload.message.sender_handle,
        direction: parsed.payload.message.direction,
        listHeaders: parsed.payload.listHeaders,
      });
    }
  }

  return { payload: { account: parsedAccount, heartbeat: parsedHeartbeat, messages, bulk } };
}

/**
 * One message. `body` may legitimately be empty — a message whose body would not decode is stored
 * anyway, with whatever came out, so that a failure to read something leaves a visible row rather
 * than no trace at all.
 */
function parseMessage(
  raw: unknown,
  path: string,
): Parsed<{ message: NormalizedMessage; listHeaders: string[] }> {
  const record = asRecord(raw);
  if (record === undefined) return { error: `${path.slice(0, -1)} must be an object` };

  const read = readerFor(record, path);
  const message: NormalizedMessage = {
    source_id: read.string('source_id'),
    rfc822_message_id: read.optionalString('rfc822_message_id'),
    thread_key: read.string('thread_key'),
    direction: read.oneOf('direction', DIRECTIONS),
    sender_handle: read.string('sender_handle'),
    sender_name: read.optionalString('sender_name'),
    chat_name: read.optionalString('chat_name'),
    participants: read.stringArray('participants'),
    subject: read.optionalString('subject'),
    body: read.optionalString('body') ?? '',
    received_at: read.timestamp('received_at'),
    body_extracted: read.boolean('body_extracted'),
    has_attachments: read.boolean('has_attachments'),
    in_reply_to: read.optionalString('in_reply_to'),
    references_ids: read.stringArray('references_ids'),
  };
  // Not a column: the names of the bulk-mail headers the daemon saw, lower-cased. Kept beside
  // the message rather than on it so the store never tries to write a field the table lacks.
  const listHeaders = read.optionalStringArray('list_headers') ?? [];

  return read.error === undefined ? { payload: { message, listHeaders } } : { error: read.error };
}
