/**
 * The shapes the Comms module moves around: what a source hands the store, what the store hands
 * back, and the small enums the schema CHECKs down to a fixed list.
 *
 * These are declared BY HAND rather than imported from the frontend's generated Supabase types.
 * The Worker is its own deployable with its own tsconfig and no dependency on `frontend/`, so a
 * generated file it cannot regenerate is not a contract it can hold. The migration is the
 * contract; this file is the Worker's reading of it, and the two are kept in step by review.
 *
 * Two conventions run through everything below:
 *
 * 1. PostgREST speaks JSON, so an absent column arrives as `null`. This package bans the `null`
 *    literal in source, so every wire row is mapped to `undefined` at the boundary (in `store.ts`)
 *    and nothing downstream ever sees one.
 * 2. An optional field is written `field?: T | undefined` rather than `field?: T`. Under
 *    `exactOptionalPropertyTypes` those differ: the second forbids writing the key at all with an
 *    undefined value, which makes every producer spell out a conditional spread per field. The
 *    first says what is actually true — the key may be absent or explicitly nothing — and lets
 *    `JSON.stringify` drop it on the way to the database.
 */

/** The four tiers a message can land in. `fyi` is the unbadged shelf; the other three are counted. */
export type CommTier = 'asap' | 'today' | 'whenever' | 'fyi';

/** What kind of thing an account is, which decides how it is polled. */
export type CommAccountKind = 'gmail' | 'imap' | 'imessage';

/** Which side of the conversation a message is on. Outbound is the signal that drains a thread. */
export type CommDirection = 'inbound' | 'outbound';

/** Where an account is polled from: the Worker's own cron, or the Mac daemon's ingest POSTs. */
export type CommAccountHome = 'worker' | 'daemon';

/**
 * Who or what set a message's tier. `unjudged` covers the two can't-judge paths (a body that
 * never decoded, and a message that exhausted its classification attempts); `refusal` is the
 * model declining to answer, which is terminal and shelved rather than queued.
 */
export type JudgedBy = 'model' | 'filter' | 'owner' | 'unjudged' | 'refusal';

/** The four exits from the queue. `reply` is detected; the other three are acts of the owner. */
export type ClearedBy = 'reply' | 'nothing_to_answer' | 'not_replying' | 'inbox_item';

/** Why the deterministic header filter — rather than the model — shelved a message. */
export type FilteredReason = 'newsletter';

/** What the owner did that produced a correction. Both double as few-shot examples. */
export type CorrectionKind = 'tier_change' | 'nothing_to_answer';

/** How much a person's messages matter, independent of how any one of them reads. */
export type PersonPriority = 'high' | 'normal' | 'low';

/** The two kinds of address a person is reachable at. */
export type HandleKind = 'email' | 'phone';

/**
 * A message as every source produces it and the store ingests it — the one shape the Gmail
 * poller, the IMAP reader and the iMessage reader all normalise to, so nothing downstream has to
 * know which source a row came from.
 *
 * `source_id` is the per-source IDENTITY, never the cursor: Gmail's message id, the RFC822
 * Message-ID (or `UIDVALIDITY:UID`) for IMAP, chat.db's guid for iMessage. A cursor says where to
 * resume; an identity says whether two rows are the same message, and the two are not the same
 * question — a UIDVALIDITY change reassigns every UID, and chat.db ROWIDs do not survive a
 * rebuild. Keyed on the identity a re-seed is a no-op; keyed on the cursor it is a corruption
 * that looks like normal operation.
 */
export interface NormalizedMessage {
  source_id: string;
  rfc822_message_id?: string | undefined;
  thread_key: string;
  direction: CommDirection;
  sender_handle: string;
  sender_name?: string | undefined;
  chat_name?: string | undefined;
  participants: string[];
  subject?: string | undefined;
  body: string;
  /** ISO 8601, and the time the message arrived — not the time it was polled. */
  received_at: string;
  /** False when the body failed to decode. The row is still written, and takes the can't-judge path. */
  body_extracted: boolean;
  has_attachments: boolean;
  in_reply_to?: string | undefined;
  references_ids: string[];
}

/** One mailbox or channel, with the health and cursor state its poller keeps on it. */
export interface CommAccount {
  id: string;
  key: string;
  kind: CommAccountKind;
  label: string;
  home: CommAccountHome;
  /** The owner's own addresses on this account, lower-cased. A message from one of these is outbound. */
  owner_handles: string[];
  enabled: boolean;
  /** How long without a successful poll counts as stale, per source. */
  expected_interval_seconds: number;
  /** Whatever the poller resumes from — a historyId, a `{uidvalidity, uid}`, a ROWID. */
  cursor: unknown;
  /** Stamped on every successful POLL, not on every message: quiet and broken differ only here. */
  last_seen_at?: string | undefined;
  last_error?: string | undefined;
  last_error_at?: string | undefined;
}

/** A stored message: every column of the table, with its nulls already mapped to `undefined`. */
export interface CommMessage {
  id: string;
  account_id: string;
  source_id: string;
  rfc822_message_id?: string | undefined;
  thread_key: string;
  direction: CommDirection;
  sender_handle: string;
  sender_name?: string | undefined;
  chat_name?: string | undefined;
  participants: string[];
  subject?: string | undefined;
  body: string;
  received_at: string;
  body_extracted: boolean;
  has_attachments: boolean;
  in_reply_to?: string | undefined;
  references_ids: string[];
  filtered_reason?: FilteredReason | undefined;
  classify_attempts: number;
  tier?: CommTier | undefined;
  judged_by?: JudgedBy | undefined;
  ask?: string | undefined;
  verdict_id?: string | undefined;
  classified_at?: string | undefined;
  reclassify_requested_at?: string | undefined;
  cleared_at?: string | undefined;
  cleared_by?: ClearedBy | undefined;
  inbox_item_id?: string | undefined;
  created_at: string;
}

/**
 * A verdict on its way into the database. Every field of the provenance is required on purpose:
 * a verdict stamped with only one of the rubric and example-set versions cannot be reconstructed
 * later, which defeats the point of versioning either.
 */
export interface CommVerdictInsert {
  message_id: string;
  tier: CommTier;
  owes_reply: boolean;
  ask: string;
  reason: string;
  provider: string;
  model: string;
  prompt_version: number;
  rubric_version: number;
  example_set_version: number;
  /** The roster person the sender resolved to, when one did. */
  person_id?: string | undefined;
}

/** One address a person is reachable at: a lower-cased email, or a phone number in E.164. */
export interface CommHandle {
  handle: string;
  kind: HandleKind;
}

/** A person on the roster, with every handle that resolves to them. */
export interface CommPerson {
  id: string;
  name: string;
  priority: PersonPriority;
  notes?: string | undefined;
  handles: CommHandle[];
}

/** One version of the rubric. Append-only, so a verdict's `rubric_version` stays resolvable. */
export interface CommRubric {
  id: string;
  version: number;
  body: string;
  created_at: string;
}

/**
 * A correction, read as a few-shot example. The message text is denormalised onto the row and
 * outlives the message it came from, which is what lets the example set improve across the
 * 60-day retention sweep rather than resetting every two months.
 */
export interface CommExample {
  id: string;
  sender_handle: string;
  sender_name?: string | undefined;
  account_label: string;
  subject?: string | undefined;
  body_excerpt?: string | undefined;
  /** The tier the model chose. Absent when the row had no verdict to contrast against. */
  model_tier?: CommTier | undefined;
  chosen_tier: CommTier;
  kind: CorrectionKind;
  created_at: string;
}

/**
 * What one classifier run reports about itself. A run that failed carries the reason, because a
 * classifier outage is not a source outage — ingestion is healthy and judgment has stalled, and
 * the fix is a different one.
 */
export type ClassifierHealthPatch = { at: Date; ok: true } | { at: Date; ok: false; error: string };

/**
 * What a poller claims about an account when it registers itself. Accounts self-register rather
 * than being seeded by a migration, because the two alfred instances hold different accounts.
 * Deliberately only the columns a poller owns: cursor and health are written by their own calls,
 * so a re-registration on every poll can never clobber them.
 */
export interface AccountUpsert {
  key: string;
  kind: CommAccountKind;
  label: string;
  home: CommAccountHome;
  owner_handles?: string[] | undefined;
  expected_interval_seconds?: number | undefined;
}
