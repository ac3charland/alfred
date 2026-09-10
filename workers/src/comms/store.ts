/**
 * Every database access the Comms module makes, in one place.
 *
 * Three writers reach the comms tables and this is one of them: the Worker, holding the
 * service-role key, writing messages, verdicts and account health. (The browser writes triage
 * state under RLS; the Mac daemon holds no database credential at all and reaches the tables only
 * by POSTing to the Worker's signed ingest endpoint, which lands here.) Keeping the whole surface
 * in one module is what lets the Gmail poller, the classifier sweep and the ingest endpoint stay
 * about their own logic — none of them builds a URL or knows a column name.
 *
 * It is built on `supabase.ts`'s plumbing rather than beside it: the same auth headers, the same
 * `${SUPABASE_URL}/rest/v1/…` builder, and above all the same `Supabase <context> failed:
 * <status> <detail>` throw, so a rejected comms write reads in the log exactly like a rejected
 * Inbox write. The one thing that plumbing cannot express is an upsert — PostgREST takes the
 * conflict-resolution instruction as a `Prefer` header and the shared helper sends its own
 * headers verbatim — so the three upserts below build their request through `upsertJson`, which
 * re-uses everything else including the throw.
 *
 * PostgREST speaks JSON, so an absent column arrives as `null`. Every read maps those to
 * `undefined` at the boundary (the `Wire*` types below are the only place a `null` is named), and
 * every write leaves an unwanted column out of the payload entirely rather than sending a null —
 * so nothing here can clear a column by accident.
 */
import { type SupabaseEnv, fetchJson, headers, restQueryUrl } from '../supabase';
import type {
  AccountUpsert,
  ClassifierHealthPatch,
  ClearedBy,
  CommAccount,
  CommAccountHome,
  CommAccountKind,
  CommDirection,
  CommExample,
  CommMessage,
  CommPerson,
  CommRubric,
  CommTier,
  CommVerdictInsert,
  CorrectionKind,
  FilteredReason,
  HandleKind,
  JudgedBy,
  NormalizedMessage,
  PersonPriority,
} from './types';

/** What one ingest run did, and the endpoint's whole response body. */
export interface IngestResult {
  /** Rows the database actually stored — a message it had already seen is not one. */
  accepted: number;
  /** Rows it had already seen. A re-seed after a lost cursor is all duplicates and no harm. */
  duplicates: number;
  /** Queued rows an outbound message in this batch cleared by being a reply. */
  drained: number;
}

/** `${SUPABASE_URL}/rest/v1/rpc/<name>` — the POST endpoint for a database function. */
function rpcUrl(env: SupabaseEnv, name: string): string {
  return restQueryUrl(env, `rpc/${name}`, {});
}

/**
 * POST an upsert, telling PostgREST what to do about a conflicting row.
 *
 * That instruction only travels as a `Prefer` header, which the shared `fetchJson` cannot carry
 * because it sends the module's standard headers verbatim — so an upsert builds its own request.
 * The failure shape is deliberately the shared one: a rejected upsert has to read like every
 * other rejected call in the log rather than announcing that it took a different code path.
 */
async function upsertJson<T>(
  env: SupabaseEnv,
  url: string,
  body: unknown,
  resolution: 'merge-duplicates' | 'ignore-duplicates',
  context: string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers(env), Prefer: `resolution=${resolution},return=representation` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${context} failed: ${String(response.status)} ${detail}`);
  }
  return response.json<T>();
}

/**
 * The first row of a write that was asked to return what it wrote, or a throw.
 *
 * Zero rows back from an insert or an upsert is not an empty result, it is a write that did not
 * happen — and the callers below hand their caller an id or an account off the back of it, so
 * inventing one would push the failure somewhere it can no longer be explained.
 */
function firstRow<T>(rows: T[], context: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`Supabase ${context} returned no row`);
  return row;
}

/** A narrowing predicate, so an optional field can be dropped from a list without a cast. */
function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}

// ── comm_accounts ────────────────────────────────────────────────────────────

/**
 * `comm_accounts` as PostgREST returns it.
 *
 * The enum-typed and CHECK-constrained columns are declared at their narrow types rather than as
 * `string`: the schema will not let a row exist with any other value, so the narrow type is the
 * guarantee written down rather than a claim this module is making.
 */
interface WireAccount {
  id: string;
  key: string;
  kind: CommAccountKind;
  label: string;
  home: CommAccountHome;
  owner_handles: string[];
  enabled: boolean;
  expected_interval_seconds: number;
  cursor: unknown;
  last_seen_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

function toAccount(row: WireAccount): CommAccount {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    label: row.label,
    home: row.home,
    owner_handles: row.owner_handles,
    enabled: row.enabled,
    expected_interval_seconds: row.expected_interval_seconds,
    cursor: row.cursor ?? undefined,
    last_seen_at: row.last_seen_at ?? undefined,
    last_error: row.last_error ?? undefined,
    last_error_at: row.last_error_at ?? undefined,
  };
}

/**
 * Register an account, or re-register one that already exists, and hand back its current row.
 *
 * Accounts self-register on their poller's first run rather than being seeded by a migration,
 * because two alfred instances hold different accounts and a migration may not assume either's
 * data. The payload carries ONLY the columns a poller owns: cursor, health and `enabled` are
 * written by their own calls, so a daemon that re-registers on every heartbeat — which it does —
 * can never reset the account to "never polled" with the very call that reports it is working.
 */
export async function upsertAccount(
  env: SupabaseEnv,
  account: AccountUpsert,
): Promise<CommAccount> {
  const payload: Record<string, unknown> = {
    key: account.key,
    kind: account.kind,
    label: account.label,
    home: account.home,
  };
  if (account.owner_handles !== undefined) payload['owner_handles'] = account.owner_handles;
  if (account.expected_interval_seconds !== undefined) {
    payload['expected_interval_seconds'] = account.expected_interval_seconds;
  }

  const rows = await upsertJson<WireAccount[]>(
    env,
    restQueryUrl(env, 'comm_accounts', { on_conflict: 'key' }),
    [payload],
    'merge-duplicates',
    'POST comm_accounts',
  );
  return toAccount(firstRow(rows, 'POST comm_accounts'));
}

/** Every account, in key order — the poller's worklist and the health strip's source. */
export async function fetchAccounts(env: SupabaseEnv): Promise<CommAccount[]> {
  const url = restQueryUrl(env, 'comm_accounts', { select: '*', order: 'key.asc' });
  const rows = await fetchJson<WireAccount[]>(env, url, {}, 'GET comm_accounts');
  return rows.map((row) => toAccount(row));
}

/** One account by its stable slug, or undefined when nothing has registered under it yet. */
export async function fetchAccountByKey(
  env: SupabaseEnv,
  key: string,
): Promise<CommAccount | undefined> {
  const url = restQueryUrl(env, 'comm_accounts', {
    select: '*',
    key: `eq.${key}`,
    limit: '1',
  });
  const rows = await fetchJson<WireAccount[]>(env, url, {}, 'GET comm_accounts');
  const [row] = rows;
  return row === undefined ? undefined : toAccount(row);
}

/**
 * Stamp a successful poll, and store where the next one resumes from.
 *
 * The stamp goes on the POLL, not on the message: volume alone cannot tell a quiet account from a
 * dead one, and a successful poll is the only thing that can. A poll that produced no cursor
 * leaves the stored one untouched rather than clearing it.
 */
export async function recordPollSuccess(
  env: SupabaseEnv,
  accountId: string,
  poll: { at: Date; cursor?: unknown },
): Promise<void> {
  const updates: Record<string, unknown> = { last_seen_at: poll.at.toISOString() };
  if (poll.cursor !== undefined) updates['cursor'] = poll.cursor;
  await patchAccount(env, accountId, updates);
}

/**
 * Record a failed poll. Deliberately never touches `last_seen_at`: that column answers "is
 * anything still arriving", and moving it here would paint a dead account green — the exact
 * failure the per-account health exists to prevent.
 */
export async function recordPollError(
  env: SupabaseEnv,
  accountId: string,
  failure: { at: Date; error: string },
): Promise<void> {
  await patchAccount(env, accountId, {
    last_error: failure.error,
    last_error_at: failure.at.toISOString(),
  });
}

async function patchAccount(
  env: SupabaseEnv,
  accountId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const url = restQueryUrl(env, 'comm_accounts', { id: `eq.${accountId}` });
  await fetchJson<unknown[]>(
    env,
    url,
    { method: 'PATCH', body: JSON.stringify(updates) },
    `PATCH comm_accounts (${accountId})`,
  );
}

// ── comm_messages ────────────────────────────────────────────────────────────

interface WireMessage {
  id: string;
  account_id: string;
  source_id: string;
  rfc822_message_id: string | null;
  thread_key: string;
  direction: CommDirection;
  sender_handle: string;
  sender_name: string | null;
  chat_name: string | null;
  participants: string[];
  subject: string | null;
  body: string;
  received_at: string;
  body_extracted: boolean;
  has_attachments: boolean;
  in_reply_to: string | null;
  references_ids: string[];
  filtered_reason: FilteredReason | null;
  classify_attempts: number;
  tier: CommTier | null;
  judged_by: JudgedBy | null;
  ask: string | null;
  verdict_id: string | null;
  classified_at: string | null;
  reclassify_requested_at: string | null;
  cleared_at: string | null;
  cleared_by: ClearedBy | null;
  inbox_item_id: string | null;
  created_at: string;
}

function toMessage(row: WireMessage): CommMessage {
  return {
    id: row.id,
    account_id: row.account_id,
    source_id: row.source_id,
    rfc822_message_id: row.rfc822_message_id ?? undefined,
    thread_key: row.thread_key,
    direction: row.direction,
    sender_handle: row.sender_handle,
    sender_name: row.sender_name ?? undefined,
    chat_name: row.chat_name ?? undefined,
    participants: row.participants,
    subject: row.subject ?? undefined,
    body: row.body,
    received_at: row.received_at,
    body_extracted: row.body_extracted,
    has_attachments: row.has_attachments,
    in_reply_to: row.in_reply_to ?? undefined,
    references_ids: row.references_ids,
    filtered_reason: row.filtered_reason ?? undefined,
    classify_attempts: row.classify_attempts,
    tier: row.tier ?? undefined,
    judged_by: row.judged_by ?? undefined,
    ask: row.ask ?? undefined,
    verdict_id: row.verdict_id ?? undefined,
    classified_at: row.classified_at ?? undefined,
    reclassify_requested_at: row.reclassify_requested_at ?? undefined,
    cleared_at: row.cleared_at ?? undefined,
    cleared_by: row.cleared_by ?? undefined,
    inbox_item_id: row.inbox_item_id ?? undefined,
    created_at: row.created_at,
  };
}

/**
 * Store a batch of messages and let the ones the owner sent drain the threads they answer.
 *
 * Three things are worth knowing about this call:
 *
 * The account's own handles decide direction, not the source. A source that reports its Sent
 * folder as arriving mail would otherwise put the owner's own replies in the queue; the
 * comparison is lower-cased because an address is not case-sensitive and no source normalises
 * the same way twice.
 *
 * The insert is one request and lets the database dedupe. The unique key is (account, source
 * identity) and the identity is never the cursor, so re-sending a message the database already
 * holds — which a re-seed after a lost cursor does by design — is a no-op rather than a
 * duplicate. `accepted` counts what was genuinely new; the rest were already here.
 *
 * The drain runs for every outbound message even when the insert ignored it as a duplicate. A
 * re-seed re-delivers the owner's replies, and those replies are exactly what should clear a
 * queue nobody has drained by hand.
 */
export async function ingestMessages(
  env: SupabaseEnv,
  account: CommAccount,
  messages: NormalizedMessage[],
  now: Date,
): Promise<IngestResult> {
  if (messages.length === 0) return { accepted: 0, duplicates: 0, drained: 0 };

  const ownerHandles = new Set(account.owner_handles.map((handle) => handle.toLowerCase()));
  const directed = messages.map((message) => ({
    message,
    direction: ownerHandles.has(message.sender_handle.toLowerCase())
      ? ('outbound' as const)
      : message.direction,
  }));

  const rows = directed.map(({ message, direction }) => ({
    account_id: account.id,
    source_id: message.source_id,
    rfc822_message_id: message.rfc822_message_id,
    thread_key: message.thread_key,
    direction,
    sender_handle: message.sender_handle,
    sender_name: message.sender_name,
    chat_name: message.chat_name,
    participants: message.participants,
    subject: message.subject,
    body: message.body,
    received_at: message.received_at,
    body_extracted: message.body_extracted,
    has_attachments: message.has_attachments,
    in_reply_to: message.in_reply_to,
    references_ids: message.references_ids,
  }));

  const stored = await upsertJson<{ id: string }[]>(
    env,
    restQueryUrl(env, 'comm_messages', { on_conflict: 'account_id,source_id' }),
    rows,
    'ignore-duplicates',
    'POST comm_messages',
  );

  let drained = 0;
  // Sequentially, like every other loop in this Worker: each drain is an UPDATE over the same
  // account's rows, and there is never enough of a batch for the latency to be worth the
  // interleaving.
  for (const { message, direction } of directed) {
    if (direction !== 'outbound') continue;
    drained += await recordReply(env, account, message, now);
  }

  return {
    accepted: stored.length,
    duplicates: messages.length - stored.length,
    drained,
  };
}

/**
 * Clear every queued row this reply answers, and say how many that was.
 *
 * The drain reads the reply's OWN timestamp rather than the moment it happened to be ingested:
 * an answer clears what arrived before it was sent, and ingest can be minutes or a sleep cycle
 * later, which would also clear whatever landed in between. A timestamp in the future — a skewed
 * laptop clock, or a header the sender wrote — is clamped back to now, so a bad clock cannot
 * clear a queue that has not happened yet.
 */
async function recordReply(
  env: SupabaseEnv,
  account: CommAccount,
  message: NormalizedMessage,
  now: Date,
): Promise<number> {
  const sentAt = new Date(message.received_at);
  const at = Number.isNaN(sentAt.getTime()) || sentAt > now ? now : sentAt;

  return fetchJson<number>(
    env,
    rpcUrl(env, 'comm_record_reply'),
    {
      method: 'POST',
      body: JSON.stringify({
        p_account: account.id,
        p_thread_key: message.thread_key,
        p_references: [...message.references_ids, message.in_reply_to].filter((id) =>
          isPresent(id),
        ),
        p_at: at.toISOString(),
      }),
    },
    'POST rpc/comm_record_reply',
  );
}

/**
 * The classifier's worklist: inbound messages nothing has judged yet, oldest first, under the
 * attempt ceiling. A row that has exhausted its attempts drops out of this query entirely — it
 * is handled by `fetchUnjudgedAtCeiling` instead, which parks it rather than retrying it.
 */
export async function fetchUnjudgedMessages(
  env: SupabaseEnv,
  options: { limit: number; attemptCeiling: number },
): Promise<CommMessage[]> {
  const url = restQueryUrl(env, 'comm_messages', {
    select: '*',
    direction: 'eq.inbound',
    tier: 'is.null',
    classify_attempts: `lt.${String(options.attemptCeiling)}`,
    order: 'received_at.asc',
    limit: String(options.limit),
  });
  const rows = await fetchJson<WireMessage[]>(env, url, {}, 'GET comm_messages');
  return rows.map((row) => toMessage(row));
}

/**
 * The rows the owner explicitly asked to have re-judged, longest-waiting first. Nothing is ever
 * re-judged silently — editing the rubric, the roster or the example set sweeps nothing — so this
 * is the only path back to the classifier for a message that already has a tier.
 */
export async function fetchReclassifyRequests(
  env: SupabaseEnv,
  options: { limit: number },
): Promise<CommMessage[]> {
  const url = restQueryUrl(env, 'comm_messages', {
    select: '*',
    reclassify_requested_at: 'not.is.null',
    direction: 'eq.inbound',
    order: 'reclassify_requested_at.asc',
    limit: String(options.limit),
  });
  const rows = await fetchJson<WireMessage[]>(env, url, {}, 'GET comm_messages');
  return rows.map((row) => toMessage(row));
}

/**
 * The rows that have spent every attempt and still have no tier. Nothing is silently shelved, so
 * these are parked on a counted tier and marked as unjudged rather than left invisible.
 */
export async function fetchUnjudgedAtCeiling(
  env: SupabaseEnv,
  options: { attemptCeiling: number; limit: number },
): Promise<CommMessage[]> {
  const url = restQueryUrl(env, 'comm_messages', {
    select: '*',
    direction: 'eq.inbound',
    tier: 'is.null',
    classify_attempts: `gte.${String(options.attemptCeiling)}`,
    order: 'received_at.asc',
    limit: String(options.limit),
  });
  const rows = await fetchJson<WireMessage[]>(env, url, {}, 'GET comm_messages');
  return rows.map((row) => toMessage(row));
}

/**
 * PATCH one message by id, and report how many rows matched.
 *
 * Both options narrow the filter for the same reason the Inbox sweep's write is compare-and-set:
 * scheduled invocations are not serialized, so a slow tick can overlap the next one and both can
 * read the same row before either has written it. Each option guards a different field the caller
 * derived its update from, so a write that blindly PATCHes "the thing I read, changed" cannot
 * clobber a row that moved underneath it — with the filter the loser matches nothing and takes
 * the "nothing to write" branch instead.
 *
 * `onlyIfUnjudged` adds `tier=is.null`: the loser of a race to file a verdict matches nothing
 * instead of stamping a second one over the first.
 *
 * `ifAttemptsEquals` adds `classify_attempts=eq.<n>`, where `<n>` is the count as it was READ at
 * the top of the tick. A write that PATCHes "count + 1" without this filter always succeeds, even
 * against a row an overlapping tick already advanced past `n` — silently losing that tick's
 * attempt. With the filter, a write whose base has moved matches nothing: a benign no-op, not an
 * error, because the count is already right, just not written by this call.
 */
export async function patchMessage(
  env: SupabaseEnv,
  id: string,
  updates: Record<string, unknown>,
  options: { onlyIfUnjudged?: boolean; ifAttemptsEquals?: number } = {},
): Promise<number> {
  const filters: Record<string, string> = { id: `eq.${id}` };
  if (options.onlyIfUnjudged === true) filters['tier'] = 'is.null';
  if (options.ifAttemptsEquals !== undefined) {
    filters['classify_attempts'] = `eq.${String(options.ifAttemptsEquals)}`;
  }
  const rows = await fetchJson<unknown[]>(
    env,
    restQueryUrl(env, 'comm_messages', filters),
    { method: 'PATCH', body: JSON.stringify(updates) },
    `PATCH comm_messages (${id})`,
  );
  return rows.length;
}

// ── comm_verdicts ────────────────────────────────────────────────────────────

/**
 * Write a verdict and return its id, so the message can be pointed at it. A re-classification
 * inserts a new row rather than destroying the old one — "why did it say that" stays answerable
 * after the tier has moved on.
 */
export async function insertVerdict(env: SupabaseEnv, verdict: CommVerdictInsert): Promise<string> {
  const rows = await fetchJson<{ id: string }[]>(
    env,
    restQueryUrl(env, 'comm_verdicts', {}),
    { method: 'POST', body: JSON.stringify(verdict) },
    'POST comm_verdicts',
  );
  return firstRow(rows, 'POST comm_verdicts').id;
}

// ── comm_rubrics, comm_people, comm_corrections ──────────────────────────────

/** The rubric in force. The table is append-only, so the current one is simply the highest version. */
export async function fetchCurrentRubric(env: SupabaseEnv): Promise<CommRubric | undefined> {
  const url = restQueryUrl(env, 'comm_rubrics', {
    select: '*',
    order: 'version.desc',
    limit: '1',
  });
  const rows = await fetchJson<CommRubric[]>(env, url, {}, 'GET comm_rubrics');
  const [row] = rows;
  return row;
}

interface WirePerson {
  id: string;
  name: string;
  priority: PersonPriority;
  notes: string | null;
  comm_handles: { handle: string; kind: HandleKind }[];
}

/**
 * The roster, each person with every handle that resolves to them. Read as one embedded query
 * rather than two: the same human is a phone number in iMessage and an address in two mailboxes,
 * and it is the person — not the address — the prompt reasons about.
 */
export async function fetchPeople(env: SupabaseEnv): Promise<CommPerson[]> {
  const url = restQueryUrl(env, 'comm_people', {
    select: '*,comm_handles(handle,kind)',
    order: 'name.asc',
  });
  const rows = await fetchJson<WirePerson[]>(env, url, {}, 'GET comm_people');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority,
    notes: row.notes ?? undefined,
    handles: row.comm_handles.map((handle) => ({ handle: handle.handle, kind: handle.kind })),
  }));
}

interface WireExample {
  id: string;
  sender_handle: string;
  sender_name: string | null;
  account_label: string;
  subject: string | null;
  body_excerpt: string | null;
  model_tier: CommTier | null;
  chosen_tier: CommTier;
  kind: CorrectionKind;
  created_at: string;
}

/**
 * The corrections the prompt draws its worked examples from, newest first. A pruned example is
 * one that steered badly and a purged one has lost its text to a deliberate purge; neither has
 * anything left to teach, so both are filtered out here rather than downstream.
 */
export async function fetchExamples(
  env: SupabaseEnv,
  options: { limit: number },
): Promise<CommExample[]> {
  const url = restQueryUrl(env, 'comm_corrections', {
    select:
      'id,sender_handle,sender_name,account_label,subject,body_excerpt,model_tier,chosen_tier,kind,created_at',
    pruned_at: 'is.null',
    purged_at: 'is.null',
    body_excerpt: 'not.is.null',
    order: 'created_at.desc',
    limit: String(options.limit),
  });
  const rows = await fetchJson<WireExample[]>(env, url, {}, 'GET comm_corrections');
  return rows.map((row) => ({
    id: row.id,
    sender_handle: row.sender_handle,
    sender_name: row.sender_name ?? undefined,
    account_label: row.account_label,
    subject: row.subject ?? undefined,
    body_excerpt: row.body_excerpt ?? undefined,
    model_tier: row.model_tier ?? undefined,
    chosen_tier: row.chosen_tier,
    kind: row.kind,
    created_at: row.created_at,
  }));
}

/**
 * The version of the example set as it stands right now, stamped onto every verdict beside the
 * rubric version. The database owns the number — every insert and every prune bumps it there —
 * so no writer can forget to, and no two writers can disagree about what the count is.
 */
export function fetchExampleSetVersion(env: SupabaseEnv): Promise<number> {
  return fetchJson<number>(
    env,
    rpcUrl(env, 'comm_example_set_version'),
    { method: 'POST', body: JSON.stringify({}) },
    'POST rpc/comm_example_set_version',
  );
}

// ── comm_classifier_health, retention ────────────────────────────────────────

/**
 * Record that the classifier ran, and whether it got anywhere.
 *
 * One row, upserted, because a classifier outage is a module-level state rather than a source
 * one: ingestion is healthy and judgment has stalled, and the fix is a different fix. A failed
 * run leaves the last success where it was — "stalled since" is the reading that matters, and it
 * only exists if both timestamps survive.
 */
export async function recordClassifierRun(
  env: SupabaseEnv,
  patch: ClassifierHealthPatch,
): Promise<void> {
  const at = patch.at.toISOString();
  const row: Record<string, unknown> = patch.ok
    ? { id: 1, last_run_at: at, last_success_at: at }
    : { id: 1, last_run_at: at, last_error: patch.error, last_error_at: at };

  await upsertJson<unknown[]>(
    env,
    restQueryUrl(env, 'comm_classifier_health', { on_conflict: 'id' }),
    [row],
    'merge-duplicates',
    'POST comm_classifier_health',
  );
}

/**
 * Delete every message older than the retention window and report how many went. The cutoff is
 * computed in the database, so the Worker's clock never decides what gets deleted.
 */
export function sweepExpired(env: SupabaseEnv, days: number): Promise<number> {
  return fetchJson<number>(
    env,
    rpcUrl(env, 'comm_sweep_expired'),
    { method: 'POST', body: JSON.stringify({ p_days: days }) },
    'POST rpc/comm_sweep_expired',
  );
}
