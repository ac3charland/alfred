/**
 * Shared shapes for the session-ledger CLI. `LedgerRow` mirrors the `code_sessions` table
 * (database/migrations) minus `refreshed_at`, which the upsert RPC stamps itself; the POST
 * /api/code/sessions route validates exactly this shape (frontend/lib/api/schemas.ts).
 */

/** A JSON object — the raw session record and the other payloads this tool reads. */
export type JsonObject = Record<string, unknown>;

/** Which alfred launch prompt started a session. */
export type LaunchLane =
  | 'refinement'
  | 'spike'
  | 'bug'
  | 'implementation'
  | 'bypass'
  | 'epic-refinement'
  | 'epic-implementation';

/** Every warning a row can carry: each names why a value is missing or suspect. */
export type WarningCode =
  | 'no_pr'
  | 'no_alfred_block'
  | 'extra_prs'
  | 'ref_from_title'
  | 'story_missing'
  | 'builder_missing'
  | 'builder_threw'
  | 'builder_changed_near_start'
  | 'not_from_main'
  | 'pr_head_unavailable'
  | 'spec_missing_at_base'
  | 'spec_changed_since_refinement'
  | 'session_record_unavailable'
  | 'session_record_invalid';

/** A skill the rebuilt prompt names, with its blob at base (null: it didn't exist yet). */
export interface SkillRef {
  path: string;
  blob_sha: string | null;
}

export interface LedgerRow {
  session_id: string;
  repo: string;
  title: string | null;
  session_created_at: string | null;
  status: string | null;
  configured_model: string | null;
  model: string | null;
  served_model: string | null;
  effort_level: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  ref: string | null;
  launch_lane: LaunchLane | null;
  pr_number: number | null;
  pr_state: 'merged' | 'closed' | 'open' | null;
  pr_opened_at: string | null;
  pr_merged_at: string | null;
  pr_closed_at: string | null;
  human_commits_after_open: number | null;
  base_sha: string | null;
  builder_sha: string | null;
  prompt: string | null;
  prompt_source: 'reconstructed' | 'recorded' | null;
  spec_path: string | null;
  spec_blob_sha: string | null;
  skills: SkillRef[];
  warnings: WarningCode[];
  session_record: JsonObject | null;
}

/**
 * GET /api/code/ledger-inputs. Stories and epics are passed to the historical builders verbatim,
 * so they stay open records; only the fields this tool reads itself are named.
 */
export interface LedgerStory extends JsonObject {
  ref: string | null;
  title: string | null;
  spec_path: string | null;
  spec_sha: string | null;
  epic_spec_path: string | null;
}

export interface LedgerEpic extends JsonObject {
  ref: string;
  spec_path: string | null;
  spec_sha: string | null;
}

export interface LedgerInputs {
  project: JsonObject;
  stories: LedgerStory[];
  epics: LedgerEpic[];
}
