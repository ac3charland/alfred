/**
 * Write `code_items` (story) and `epics` rows from the Worker via Supabase's PostgREST endpoint.
 * Also the classifier sweep's only I/O: reading eligible Inbox items and the closed world of
 * folders/projects/epics, and writing a verdict back onto an item.
 *
 * We hit the REST API with raw `fetch` rather than bundling `@supabase/supabase-js` — it keeps the
 * Worker tiny and needs no `nodejs_compat`. The Worker authenticates with the
 * SERVICE_ROLE key, which bypasses RLS — that is the trusted webhook ingress the schema's RLS
 * comment calls out. Keep that key a Worker secret; it must never reach the browser.
 */
import type { TicketUpdate } from './transitions';
import type { ClosedWorld, SweepItem, WorldEpic, WorldFolder, WorldProject } from './verdict';

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** The extra spec-snapshot columns the Worker writes after fetching the file. */
export interface SpecSnapshot {
  spec_markdown: string;
  spec_sha: string;
}

function restUrl(env: SupabaseEnv, table: string, ref: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${table}?ref=eq.${encodeURIComponent(ref)}`;
}

function headers(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    // Return the affected rows so callers can tell whether the ref actually matched a story.
    Prefer: 'return=representation',
  };
}

/**
 * PATCH one ref-keyed row of `table`. Returns the number of rows updated — 0 means the ref
 * isn't a row we track (a PR for some other repo/ticket), which the caller treats as a benign
 * no-op. Throws on a non-2xx response so the handler can log a real failure.
 *
 * `code_items` and `epics` both key on `ref` (from one shared per-project counter) and name their
 * spec/PR columns identically, so the two exported wrappers below differ only in the table.
 */
async function patchByRef(
  env: SupabaseEnv,
  table: string,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  const response = await fetch(restUrl(env, table, ref), {
    method: 'PATCH',
    headers: headers(env),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Supabase PATCH ${table} (${ref}) failed: ${String(response.status)} ${detail}`,
    );
  }

  const rows = await response.json<unknown[]>();
  return rows.length;
}

/** PATCH a `code_items` (story) row by its `ref`. */
export function patchCodeItem(
  env: SupabaseEnv,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  return patchByRef(env, 'code_items', ref, updates);
}

/** PATCH an `epics` row by its `ref` — the epic-refinement phase's target. */
export function patchEpic(
  env: SupabaseEnv,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  return patchByRef(env, 'epics', ref, updates);
}

// ── The classifier sweep ─────────────────────────────────────────────────────
//
// Four more calls, all reads except the last: the eligible-items list, the closed world the model
// picks from, the correction log's worked examples, and the verdict write-back. None of these are
// ref-keyed like the pair above, so they are siblings of `patchByRef` rather than callers of it —
// but they share its fetch/throw-on-non-2xx shape via the two helpers below.

/** Build a `${SUPABASE_URL}/rest/v1/<table>?<query>` GET URL from a flat param object. */
function restQueryUrl(env: SupabaseEnv, table: string, params: Record<string, string>): string {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * fetch `url`, parse the JSON body as `T`, and throw a descriptive error labelled `context` on a
 * non-2xx response — the one throw-on-failure shape every classifier call below shares, GET or
 * PATCH, so a rejected write (a CHECK-constraint violation, say) is a readable log line rather
 * than a swallowed exception.
 */
async function fetchJson<T>(
  env: SupabaseEnv,
  url: string,
  init: RequestInit,
  context: string,
): Promise<T> {
  const response = await fetch(url, { ...init, headers: headers(env) });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${context} failed: ${String(response.status)} ${detail}`);
  }
  return response.json<T>();
}

/** `items` as PostgREST returns it for the sweep's select list — JSON nulls, not `undefined`. */
interface WireItem {
  id: string;
  title: string;
  notes: string | null;
  raw_capture: string | null;
  source_url: string | null;
  item_type: string;
  priority: string | null;
  due_date: string | null;
  folder_id: string | null;
  intended_project_id: string | null;
  intended_epic_id: string | null;
  classify_attempts: number;
}

function toSweepItem(row: WireItem): SweepItem {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    raw_capture: row.raw_capture ?? undefined,
    source_url: row.source_url ?? undefined,
    item_type: row.item_type,
    priority: row.priority ?? undefined,
    due_date: row.due_date ?? undefined,
    folder_id: row.folder_id ?? undefined,
    intended_project_id: row.intended_project_id ?? undefined,
    intended_epic_id: row.intended_epic_id ?? undefined,
    classify_attempts: row.classify_attempts,
  };
}

/**
 * Read the items this tick may classify. Oldest first (so a burst drains in capture order
 * rather than starving the earliest item), capped at `limit`, and never a row a human already
 * owns: `dispatched_at`/`classified_at` both null, top-level only, and under the attempt
 * ceiling — a row that has exhausted its attempts drops out of the sweep entirely and goes on
 * being an ordinary unclassified Inbox item, which is the same worst case as today.
 */
export async function fetchEligibleItems(
  env: SupabaseEnv,
  options: { limit: number; attemptCeiling: number },
): Promise<SweepItem[]> {
  const url = restQueryUrl(env, 'items', {
    parent_id: 'is.null',
    dispatched_at: 'is.null',
    classified_at: 'is.null',
    classify_attempts: `lt.${String(options.attemptCeiling)}`,
    select:
      'id,title,notes,raw_capture,source_url,item_type,priority,due_date,folder_id,intended_project_id,intended_epic_id,classify_attempts',
    order: 'created_at.asc',
    limit: String(options.limit),
  });

  const rows = await fetchJson<WireItem[]>(env, url, {}, 'GET items');
  return rows.map((row) => toSweepItem(row));
}

interface WireFolder {
  id: string;
  name: string;
  description: string | null;
}

interface WireProject {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

interface WireEpic {
  id: string;
  ref: string;
  name: string;
  project_id: string;
}

function toWorldFolder(row: WireFolder): WorldFolder {
  return { id: row.id, name: row.name, description: row.description ?? undefined };
}

function toWorldProject(row: WireProject): WorldProject {
  return { id: row.id, key: row.key, name: row.name, description: row.description ?? undefined };
}

function toWorldEpic(row: WireEpic): WorldEpic {
  return { id: row.id, ref: row.ref, name: row.name, project_id: row.project_id };
}

/**
 * Read the folders / projects / epics the model may choose from, fresh for this sweep — the
 * three reads are independent, so they run concurrently. Archived epics are excluded
 * (`archived_at=is.null`): an archived epic is off the board and is not somewhere new work
 * should be filed.
 */
export async function fetchClosedWorld(env: SupabaseEnv): Promise<ClosedWorld> {
  const foldersUrl = restQueryUrl(env, 'folders', {
    select: 'id,name,description',
    order: 'name.asc',
  });
  const projectsUrl = restQueryUrl(env, 'projects', {
    select: 'id,key,name,description',
    order: 'key.asc',
  });
  const epicsUrl = restQueryUrl(env, 'epics', {
    select: 'id,ref,name,project_id',
    archived_at: 'is.null',
    order: 'ref.asc',
  });

  const [folders, projects, epics] = await Promise.all([
    fetchJson<WireFolder[]>(env, foldersUrl, {}, 'GET folders'),
    fetchJson<WireProject[]>(env, projectsUrl, {}, 'GET projects'),
    fetchJson<WireEpic[]>(env, epicsUrl, {}, 'GET epics'),
  ]);

  return {
    folders: folders.map((row) => toWorldFolder(row)),
    projects: projects.map((row) => toWorldProject(row)),
    epics: epics.map((row) => toWorldEpic(row)),
  };
}

/** One correction row as the log stores it. */
export interface CorrectionRow {
  captured_text: string;
  field: string;
  direction: 'changed' | 'filled_in' | 'blanked';
  guessed_value: string | undefined;
  chosen_value: string | undefined;
}

interface WireCorrection {
  captured_text: string;
  field: string;
  direction: string;
  guessed_value: string | null;
  chosen_value: string | null;
}

/** Read the most recent corrections, newest first, for the prompt's worked-example block. */
export async function fetchRecentCorrections(
  env: SupabaseEnv,
  limit: number,
): Promise<CorrectionRow[]> {
  const url = restQueryUrl(env, 'classification_corrections', {
    select: 'captured_text,field,direction,guessed_value,chosen_value',
    order: 'created_at.desc',
    limit: String(limit),
  });

  const rows = await fetchJson<WireCorrection[]>(env, url, {}, 'GET classification_corrections');
  // `direction` is a text column, but classification_corrections_direction_valid CHECKs it down
  // to exactly these three values before a row can exist — the cast documents that guarantee
  // rather than re-validating it.
  return rows.map((row) => ({
    captured_text: row.captured_text,
    field: row.field,
    direction: row.direction as CorrectionRow['direction'],
    guessed_value: row.guessed_value ?? undefined,
    chosen_value: row.chosen_value ?? undefined,
  }));
}

/**
 * PATCH one item by id. Returns the number of rows updated (0 = nothing matched — the row vanished
 * between being read as eligible and the verdict coming back, or `onlyIfUnclassified` lost the
 * race), and throws on a non-2xx response so a rejected write (a CHECK-constraint violation, say)
 * is a readable log line.
 *
 * `onlyIfUnclassified` adds `classified_at=is.null` to the filter, making the verdict write a
 * compare-and-set. Cloudflare does not serialize scheduled invocations, so a tick that runs long
 * can overlap the next one and both read the same eligible rows — the marker is still null until
 * the first write lands. With the filter, the loser matches zero rows and takes the existing
 * "nothing to mark" branch instead of overwriting a verdict that is already recorded.
 */
export async function patchItem(
  env: SupabaseEnv,
  id: string,
  updates: Record<string, unknown>,
  options: { onlyIfUnclassified?: boolean } = {},
): Promise<number> {
  const filters: Record<string, string> = { id: `eq.${id}` };
  if (options.onlyIfUnclassified === true) filters['classified_at'] = 'is.null';
  const url = restQueryUrl(env, 'items', filters);
  const rows = await fetchJson<unknown[]>(
    env,
    url,
    { method: 'PATCH', body: JSON.stringify(updates) },
    `PATCH items (${id})`,
  );
  return rows.length;
}
