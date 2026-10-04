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

/**
 * One Further reading item as stored: a URL the post really contains, what the linked piece is
 * called, and what the post uses it for.
 */
export interface ReaderFurtherReading {
  url: string;
  title: string;
  note: string;
}

/** The shape `reader_posts.overview` holds for a `done` post — the model's structured take. */
export interface ReaderOverview {
  novel_ideas: string[];
  evidence: string[];
  argument: string;
  who_should_read: string;
  /** Absent on a summary written before the list existed (prompt v1); empty when nothing qualifies. */
  further_reading?: ReaderFurtherReading[] | undefined;
}

/**
 * Which question the summariser asks of a post, chosen per publication and stamped on each post it
 * summarises: `essay` — what's new, the evidence, the argument (the default); `roundup` — what's
 * striking in the issue and which of its links are worth reading; `alerts` — is there a sale, a
 * security event, an action or a change the owner needs to know about.
 */
export type ReaderSummaryKind = 'essay' | 'roundup' | 'alerts';

/** Every kind, in the order the publications card offers them. */
export const READER_SUMMARY_KINDS: readonly ReaderSummaryKind[] = ['essay', 'roundup', 'alerts'];

/** What `reader_posts.overview` holds for a `done` roundup: its highlights and the links worth reading. */
export interface ReaderRoundupOverview {
  highlights: string[];
  /** The Links, stored under the essay's own key so the same checklist and sent marks serve both. */
  further_reading: ReaderFurtherReading[];
}

/** What an Alerts finding is about. */
export type ReaderAlertCategory = 'sale' | 'security' | 'action' | 'change';

/** One thing in an Alerts post that requires or rewards the owner's attention. */
export interface ReaderAlertFinding {
  category: ReaderAlertCategory;
  detail: string;
  /** The date by which to act, as the mail states it. The key is absent when it states none. */
  deadline?: string | undefined;
}

/** What `reader_posts.overview` holds for a `done` Alerts post. An empty list is "nothing notable". */
export interface ReaderAlertsOverview {
  findings: ReaderAlertFinding[];
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
  summary_kind: ReaderSummaryKind;
  first_seen_at: string;
  created_at: string;
}

/**
 * Where a post came from: a newsletter in the Gmail mirror, an article the owner moved into the
 * "To Reader" folder in Instapaper, or a report a research routine wrote for the owner.
 * `reader_posts_source_identity` CHECKs what each one carries. A research post has no text until
 * its report is delivered, and the tick reads it only from then on (see `fetchRetries`).
 */
export type ReaderPostSource = 'gmail' | 'instapaper' | 'research';

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
  /** The kind the summary was written under. Absent on one written before kinds existed: an essay. */
  summary_kind?: ReaderSummaryKind | undefined;
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
  /** Which prompt and schema the post is summarised with. */
  kind: ReaderSummaryKind;
  publication: string;
  author?: string;
  title: string;
  receivedAt: string; // ISO, for the metadata block
  wordCount: number;
  text: string; // text already capped at READER_TEXT_CHARS; the summariser applies READER_MODEL_INPUT_CHARS
  /** The stored HTML, when there is any: the model's input is built from it so its links can be numbered. */
  html?: string | undefined;
  /** The post's own address, so its links to itself are never offered as further reading. */
  canonicalUrl?: string | undefined;
}

export interface SummaryConfig {
  apiKey: string;
  model: string;
}

/** One Further reading pick as the model writes it: a link NUMBER from the post's list, never a URL. */
export interface ReaderFurtherReadingPick {
  link: number;
  title: string;
  note: string;
}

/** The overview as the model answers it — its further reading as numbered picks. */
export interface ReaderModelOverview extends Omit<ReaderOverview, 'further_reading'> {
  further_reading: ReaderFurtherReadingPick[];
}

/** The model's answer, as the schema constrains it and the guard reads it back. */
export interface ReaderSummary {
  headline: string;
  gist: string;
  overview: ReaderModelOverview;
}

/** A roundup's answer: its links are numbered picks, like the essay's Further reading. */
export interface ReaderRoundupSummary {
  headline: string;
  gist: string;
  overview: { highlights: string[]; links: ReaderFurtherReadingPick[] };
}

/** One finding as the model writes it: the schema's explicit `null` for "no deadline stated". */
export interface ReaderModelAlertFinding {
  category: ReaderAlertCategory;
  detail: string;
  deadline: string | null;
}

/** An Alerts answer. */
export interface ReaderAlertsSummary {
  headline: string;
  gist: string;
  overview: { findings: ReaderModelAlertFinding[] };
}

/**
 * What is stored: the answer normalised, its picks mapped to the URLs they number, tagged with the
 * kind it was written under so the tick can stamp it and the overview's shape is never guessed.
 */
export type StoredReaderSummary =
  | {
      kind: 'essay';
      headline: string;
      gist: string;
      overview: ReaderOverview & { further_reading: ReaderFurtherReading[] };
    }
  | { kind: 'roundup'; headline: string; gist: string; overview: ReaderRoundupOverview }
  | { kind: 'alerts'; headline: string; gist: string; overview: ReaderAlertsOverview };

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
