import type {
  CommAccount,
  CommClassifierHealth,
  CommCorrection,
  CommHandle,
  CommMessage,
  CommPerson,
  CommRubric,
  CommVerdict,
} from '@/lib/types';

/**
 * Seed builders for the eight comms tables — one home, shared by the unit tests, the stories and
 * the Playwright suite (which re-exports them from `e2e/support/constants`). Every default
 * mirrors the migration's own column default, so a fixture and a real row differ only where the
 * test says so.
 *
 * Deliberately free of any Playwright or jsdom import: it is imported from Node (the e2e seed
 * builder) and the browser (stories) alike.
 */

let sequence = 0;

/** Stable, increasing ISO timestamps so an arrival-ordered list is deterministic. */
function nextTimestamp(): string {
  sequence += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * An increasing timestamp anchored to NOW rather than to a fixed date, for the columns the app
 * reads against the clock. `received_at` decides whether a row is inside the 60-day retention
 * window at all, so a fixture pinned to a calendar date silently ages out of every seeded queue
 * as time passes — the seed still loads and the queue is simply, mysteriously, empty.
 *
 * It shares the sequence with {@link nextTimestamp}, so successive rows still arrive in the
 * order they were built.
 */
function nextRecentTimestamp(): string {
  sequence += 1;
  return new Date(Date.now() - HOUR_MS + sequence * 1000).toISOString();
}

/** Reset the timestamp sequence — call before building a fresh seed. */
export function resetCommFixtureClock(): void {
  sequence = 0;
}

/** A mailbox or channel. Defaults to a Worker-polled Gmail account on the 10-minute interval. */
export function makeCommAccount(label: string, overrides: Partial<CommAccount> = {}): CommAccount {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    key: overrides.key ?? label.toLowerCase().replaceAll(/\s+/g, '-'),
    kind: overrides.kind ?? 'gmail',
    label,
    home: overrides.home ?? 'worker',
    owner_handles: overrides.owner_handles ?? [],
    enabled: overrides.enabled ?? true,
    expected_interval_seconds: overrides.expected_interval_seconds ?? 600,
    cursor: overrides.cursor ?? null,
    last_seen_at: overrides.last_seen_at ?? null,
    last_error: overrides.last_error ?? null,
    last_error_at: overrides.last_error_at ?? null,
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/**
 * A mirrored message. Defaults to an inbound row that has not been judged yet — every triage
 * state a test wants (a tier, a clearing exit, a marker) is stated explicitly.
 */
export function makeCommMessage(
  accountId: string,
  overrides: Partial<CommMessage> = {},
): CommMessage {
  const receivedAt = overrides.received_at ?? nextRecentTimestamp();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    account_id: accountId,
    source_id: overrides.source_id ?? crypto.randomUUID(),
    rfc822_message_id: overrides.rfc822_message_id ?? null,
    thread_key: overrides.thread_key ?? crypto.randomUUID(),
    direction: overrides.direction ?? 'inbound',
    sender_handle: overrides.sender_handle ?? 'sender@example.com',
    sender_name: overrides.sender_name ?? null,
    chat_name: overrides.chat_name ?? null,
    participants: overrides.participants ?? [],
    subject: overrides.subject ?? null,
    body: overrides.body ?? '',
    received_at: receivedAt,
    body_extracted: overrides.body_extracted ?? true,
    has_attachments: overrides.has_attachments ?? false,
    in_reply_to: overrides.in_reply_to ?? null,
    references_ids: overrides.references_ids ?? [],
    filtered_reason: overrides.filtered_reason ?? null,
    classify_attempts: overrides.classify_attempts ?? 0,
    tier: overrides.tier ?? null,
    judged_by: overrides.judged_by ?? null,
    ask: overrides.ask ?? null,
    verdict_id: overrides.verdict_id ?? null,
    classified_at: overrides.classified_at ?? null,
    reclassify_requested_at: overrides.reclassify_requested_at ?? null,
    cleared_at: overrides.cleared_at ?? null,
    cleared_by: overrides.cleared_by ?? null,
    inbox_item_id: overrides.inbox_item_id ?? null,
    created_at: overrides.created_at ?? receivedAt,
  };
}

/** The model's judgment of one message, with the full provenance a re-run needs. */
export function makeCommVerdict(
  messageId: string,
  overrides: Partial<CommVerdict> = {},
): CommVerdict {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    message_id: messageId,
    tier: overrides.tier ?? 'today',
    owes_reply: overrides.owes_reply ?? true,
    ask: overrides.ask ?? 'Wants an answer.',
    reason: overrides.reason ?? 'The sender asked a direct question.',
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-haiku-4-5',
    prompt_version: overrides.prompt_version ?? 1,
    rubric_version: overrides.rubric_version ?? 1,
    example_set_version: overrides.example_set_version ?? 0,
    person_id: overrides.person_id ?? null,
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/** A roster person. `high` is the column default: the roster exists to name who matters. */
export function makeCommPerson(name: string, overrides: Partial<CommPerson> = {}): CommPerson {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name,
    priority: overrides.priority ?? 'high',
    notes: overrides.notes ?? null,
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/** One address or phone number belonging to a person. Stored already normalised. */
export function makeCommHandle(
  personId: string,
  handle: string,
  overrides: Partial<CommHandle> = {},
): CommHandle {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    person_id: personId,
    handle,
    kind: overrides.kind ?? (handle.includes('@') ? 'email' : 'phone'),
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/** One version of the rubric. Append-only, so `version` is the identity that matters. */
export function makeCommRubric(body: string, overrides: Partial<CommRubric> = {}): CommRubric {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    version: overrides.version ?? 1,
    body,
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/** A recorded correction — a row of the example set, with the message text denormalised onto it. */
export function makeCommCorrection(overrides: Partial<CommCorrection> = {}): CommCorrection {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    message_id: overrides.message_id ?? null,
    account_label: overrides.account_label ?? 'personal',
    sender_handle: overrides.sender_handle ?? 'sender@example.com',
    sender_name: overrides.sender_name ?? null,
    subject: overrides.subject ?? null,
    body_excerpt: overrides.body_excerpt ?? null,
    model_tier: overrides.model_tier ?? null,
    chosen_tier: overrides.chosen_tier ?? 'today',
    kind: overrides.kind ?? 'tier_change',
    created_version: overrides.created_version ?? 1,
    pruned_version: overrides.pruned_version ?? null,
    pruned_at: overrides.pruned_at ?? null,
    purged_at: overrides.purged_at ?? null,
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/** The singleton classifier-health row. Defaults to a healthy sweep with no recorded failure. */
export function makeCommHealth(
  overrides: Partial<CommClassifierHealth> = {},
): CommClassifierHealth {
  const runAt = overrides.last_run_at ?? nextRecentTimestamp();
  return {
    id: overrides.id ?? 1,
    last_run_at: runAt,
    last_success_at: overrides.last_success_at ?? runAt,
    last_error: overrides.last_error ?? null,
    last_error_at: overrides.last_error_at ?? null,
  };
}
