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
import type { InstapaperEnv } from '../instapaper/types';
import type { SupabaseEnv } from '../supabase';

/**
 * The four summary states `reader_posts.summary_state` is CHECKed down to. `pending` also covers
 * a stale claim waiting to be retried — `summarizing_since` (not this column) is what marks a
 * row as currently leased.
 */
export type ReaderSummaryState = 'pending' | 'done' | 'refused' | 'failed';

/** One Further reading item as stored: a link the post makes, named and explained by the model. */
export interface ReaderFurtherReading {
  /** The href exactly as the post carries it — often an opaque Substack redirect wrapper. */
  url: string;
  /** The linked piece's name, since the anchor text is often "this" or "here". */
  title: string;
  /** What the post uses it for — the reason to open it. */
  note: string;
}

/** The shape `reader_posts.overview` holds for a `done` post — the model's structured take. */
export interface ReaderOverview {
  novel_ideas: string[];
  evidence: string[];
  argument: string;
  who_should_read: string;
  /** Absent on every post summarised before the prompt asked for it. */
  further_reading?: ReaderFurtherReading[] | undefined;
}

/**
 * One Further reading pick as the model writes it: a number from the links block, never a URL,
 * so that every stored URL is one the post really contains. Worker-only.
 */
export interface ReaderFurtherReadingPick {
  link: number;
  title: string;
  note: string;
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

/**
 * Where a post came from: a newsletter in the Gmail mirror, or an article the owner moved into the
 * "To Reader" folder in Instapaper. `reader_posts_source_identity` CHECKs what each one carries.
 */
export type ReaderPostSource = 'gmail' | 'instapaper';

/** A stored post: every column of `reader_posts`, with its nulls already mapped to `undefined`. */
export interface ReaderPost {
  id: string;
  source: ReaderPostSource;
  /** Required for a newsletter; for an article, set only once something links its site to one. */
  publication_id?: string | undefined;
  comm_message_id?: string | undefined;
  /** A newsletter's dedupe key, with `gmail_message_id`. Absent on an article. */
  account_key?: string | undefined;
  gmail_message_id?: string | undefined;
  /** An article's normalised host, written once at intake. Absent on a newsletter. */
  site?: string | undefined;
  /** An article's identity; on a newsletter, the bookmark its Send created. */
  instapaper_bookmark_id?: number | undefined;
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
  /** When the retention sweep took the body. Set, and the post can never be re-summarised. */
  text_swept_at?: string | undefined;
  created_at: string;
}

/** The singleton tick-health row, seeded by the migration so the tick only ever patches it. */
export interface ReaderHealth {
  id: 1;
  last_run_at?: string | undefined;
  last_success_at?: string | undefined;
  last_error?: string | undefined;
  last_error_at?: string | undefined;
  /** The To Reader leg's last clean pass. Its own columns: newsletters flow while Instapaper fails. */
  instapaper_last_success_at?: string | undefined;
  /** The leg's last Instapaper failure, in the owner's words. */
  instapaper_last_error?: string | undefined;
  instapaper_last_error_at?: string | undefined;
  /** The cap this tick enforced — so nothing reading the row has to know the deploy var. */
  daily_cap?: number | undefined;
  /** Model calls made for `calls_day`, as the tick last counted them. */
  calls_today?: number | undefined;
  /** The UTC date (`YYYY-MM-DD`) the count belongs to. */
  calls_day?: string | undefined;
}

/**
 * What a health write says about the ceiling. The cap is known from the config before the tick
 * does anything; the count only after the tick has read it, which is why the other two are
 * optional rather than a second interface.
 */
export interface ReaderCeiling {
  daily_cap: number;
  calls_today?: number | undefined;
  calls_day?: string | undefined;
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

/**
 * The Worker's env bindings for the Reader tick: Supabase, Gmail, the model call, and the four
 * Instapaper secrets the To Reader leg runs on (all four, or the leg is off).
 */
export interface ReaderEnv extends SupabaseEnv, GmailEnv, InstapaperEnv {
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
  /** The stored HTML the text came from, when there is one — the only place the post's links are. */
  html?: string | undefined;
  /** The post's own address, which is never offered back to the model as a link. */
  canonicalUrl?: string | undefined;
}

export interface SummaryConfig {
  apiKey: string;
  model: string;
}

/** The model's answer as the guard accepts it: further reading still as link numbers. */
export interface ReaderSummary {
  headline: string;
  gist: string;
  overview: Omit<ReaderOverview, 'further_reading'> & {
    further_reading: ReaderFurtherReadingPick[];
  };
}

/** A summary ready to store: trimmed, and its further reading mapped to the post's own URLs. */
export interface StoredReaderSummary {
  headline: string;
  gist: string;
  overview: ReaderOverview & { further_reading: ReaderFurtherReading[] };
}

export interface SummaryUsage {
  inputTokens: number;
  outputTokens: number;
}

export type SummaryOutcome =
  | { kind: 'done'; summary: StoredReaderSummary; usage?: SummaryUsage }
  /**
   * `explanation` carries the API's own `stop_details.explanation` when it supplied one — absent
   * when the response carried no explanation for the category, which the SDK types as possible.
   */
  | { kind: 'refused'; explanation?: string; usage?: SummaryUsage }
  | { kind: 'counted'; error: 'max_tokens' | 'unparseable' | 'schema'; usage?: SummaryUsage }
  | { kind: 'uncounted'; error: string }
  | { kind: 'systemic'; reason: 'credentials' | 'bad_request'; error: string };
