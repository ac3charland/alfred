/**
 * The shapes the Reader module moves around: the schema's own rows, the two worklist views the
 * tick reads, the Worker's env bindings, and the seam the extractor and the summariser build to.
 *
 * These are declared BY HAND rather than imported from the frontend's generated Supabase types,
 * for the same reason `comms/types.ts` is: the Worker is its own deployable with its own tsconfig
 * and no dependency on `frontend/`, so a generated file it cannot regenerate is not a contract it
 * can hold. The migration is the contract; this file is the Worker's reading of it, kept in step
 * by review.
 *
 * Two conventions run through everything below, mirroring `comms/types.ts`:
 *
 * 1. PostgREST speaks JSON, so an absent column arrives as `null`. This package bans the `null`
 *    literal in source, so every wire row is mapped to `undefined` at the boundary and nothing
 *    downstream ever sees one.
 * 2. An optional field is written `field?: T | undefined` rather than `field?: T`. Under
 *    `exactOptionalPropertyTypes` those differ: the second forbids writing the key at all with an
 *    undefined value, which makes every producer spell out a conditional spread per field. The
 *    first says what is actually true — the key may be absent or explicitly nothing — and lets
 *    `JSON.stringify` drop it on the way to the database.
 *
 * The extractor and the summariser both import from here; the seam types at the bottom are what
 * lets them be built apart and meet at one signature.
 */
import type { GmailEnv } from '../comms/gmail';
import type { SupabaseEnv } from '../supabase';

/**
 * The four summary states `reader_posts.summary_state` is CHECKed down to. `pending` also covers
 * a stale claim waiting to be retried — `summarizing_since` (not this column) is what marks a
 * row as currently leased.
 */
export type ReaderSummaryState = 'pending' | 'done' | 'refused' | 'failed';

/** The shape `reader_posts.overview` holds for a `done` post — the model's structured take. */
export interface ReaderOverview {
  novel_ideas: string[];
  evidence: string[];
  argument: string;
  who_should_read: string;
}

/** One roster row: a publication the worklist view matches inbound mail against. */
export interface ReaderPublication {
  id: string;
  handle: string;
  name: string;
  domain?: string | undefined;
  enabled: boolean;
  source: 'auto' | 'owner';
  notes?: string | undefined;
  first_seen_at: string;
  created_at: string;
}

/** A stored post: every column of `reader_posts`, with its nulls already mapped to `undefined`. */
export interface ReaderPost {
  id: string;
  publication_id: string;
  comm_message_id?: string | undefined;
  account_key: string;
  gmail_message_id: string;
  rfc822_message_id?: string | undefined;
  title: string;
  author?: string | undefined;
  canonical_url?: string | undefined;
  received_at: string;
  /** Nullable: a retention sweep may drop it once a post is old. Never read by the tick after extraction. */
  text?: string | undefined;
  word_count: number;
  html_extracted: boolean;
  headline?: string | undefined;
  gist?: string | undefined;
  overview?: ReaderOverview | undefined;
  model?: string | undefined;
  prompt_version?: number | undefined;
  summary_state: ReaderSummaryState;
  summarize_attempts: number;
  last_error?: string | undefined;
  summarizing_since?: string | undefined;
  model_called_at?: string | undefined;
  summarized_at?: string | undefined;
  opened_at?: string | undefined;
  archived_at?: string | undefined;
  created_at: string;
}

/** The singleton tick-health row, seeded by the migration so the tick only ever patches it. */
export interface ReaderHealth {
  id: 1;
  last_run_at?: string | undefined;
  last_success_at?: string | undefined;
  last_error?: string | undefined;
  last_error_at?: string | undefined;
}

/**
 * One row of `v_reader_worklist` — an inbound gmail-personal message from an enabled publication
 * that has no post yet and hasn't been claimed. Exactly the columns the view selects.
 */
export interface WorklistRow {
  comm_message_id: string;
  gmail_message_id: string;
  account_key: string;
  publication_id: string;
  sender_handle: string;
  sender_name?: string | undefined;
  subject?: string | undefined;
  rfc822_message_id?: string | undefined;
  received_at: string;
}

/**
 * One row of `v_reader_discovery` — a Substack sender with a list header, not already on the
 * roster, from the last seven days. Exactly the columns the view selects.
 */
export interface DiscoveryRow {
  handle: string;
  name?: string | undefined;
  first_seen_at: string;
  message_count: number;
}

/** The Worker's env bindings for the Reader tick: Supabase, Gmail, and the model call. */
export interface ReaderEnv extends SupabaseEnv, GmailEnv {
  ANTHROPIC_API_KEY?: string;
  READER_MODEL?: string;
  READER_DAILY_CAP?: string;
}

// ── The extraction/summarisation seam — one signature the extractor and the summariser meet at. ──

/** What the tick hands the summariser (and the eval script prints). */
export interface SummaryInput {
  publication: string;
  author?: string;
  title: string;
  receivedAt: string; // ISO, for the metadata block
  wordCount: number;
  text: string; // text already capped at READER_TEXT_CHARS; the summariser applies READER_MODEL_INPUT_CHARS
}

export interface SummaryConfig {
  apiKey: string;
  model: string;
}

export interface ReaderSummary {
  headline: string;
  gist: string;
  overview: ReaderOverview;
}

export interface SummaryUsage {
  inputTokens: number;
  outputTokens: number;
}

export type SummaryOutcome =
  | { kind: 'done'; summary: ReaderSummary; usage?: SummaryUsage }
  | { kind: 'refused'; usage?: SummaryUsage }
  | { kind: 'counted'; error: 'max_tokens' | 'unparseable' | 'schema'; usage?: SummaryUsage }
  | { kind: 'uncounted'; error: string }
  | { kind: 'systemic'; reason: 'credentials' | 'bad_request'; error: string };
