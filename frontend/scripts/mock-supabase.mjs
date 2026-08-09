/**
 * In-memory mock of the Supabase HTTP API (GoTrue Auth + PostgREST) for the
 * Playwright integration suite.
 *
 * WHY: every Supabase touch in alfred is server-side (middleware getUser,
 * lib/data readers, route handlers) — so Playwright's browser-level page.route()
 * can't intercept it. Instead we point the Next server's NEXT_PUBLIC_SUPABASE_URL
 * at this process (see playwright.config.ts). The real @supabase/ssr client,
 * cookie handling, PostgREST query strings and route handlers all still execute;
 * only the database+auth backend is faked. That makes these genuine integration
 * tests with zero production-code branches, and lets us drive the authenticated
 * app to any seeded state.
 *
 * It implements just the subset of the wire protocol alfred uses:
 *   Auth (GoTrue):
 *     POST /auth/v1/token?grant_type=password|refresh_token   → mint a session
 *     GET  /auth/v1/user                                      → the single user
 *     POST /auth/v1/logout                                    → 204
 *   Data (PostgREST):
 *     GET|HEAD|POST|PATCH|DELETE /rest/v1/{folders,items,projects,epics,code_items,weekly_plans,
 *                                     habits,habit_entries}
 *                                                             → CRUD + filters
 *     GET  /rest/v1/{task_items,v_code_stories}               → computed views
 *     POST /rest/v1/rpc/complete_subtree                      → cascade complete
 *     POST /rest/v1/rpc/{next_code_ref,create_epic,enter_code_module,create_code_story,
 *                         convert_to_code_epic,swap_code_priority,move_code_priority,
 *                         move_code_priority_in_project}
 *                                                             → Software Factory RPCs
 *   Test control (not part of Supabase):
 *     GET  /__mock__/health   POST /__mock__/reset   POST /__mock__/seed
 *
 * Single-process, in-memory, single worker (playwright.config runs workers: 1),
 * so a shared store with per-test reset/seed is safe. Self-contained: only Node
 * builtins, no cross-package imports, so `node scripts/mock-supabase.mjs` runs
 * standalone as a Playwright webServer.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import process from 'node:process';

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? '54331');

// The single user. alfred is single-user; credentials are shared with the
// Playwright auth.setup (see e2e/support/constants.ts).
const USER = {
  id: process.env.E2E_USER_ID ?? '00000000-0000-4000-8000-000000000001',
  email: process.env.E2E_USER_EMAIL ?? 'demo@alfred.test',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2024-01-01T00:00:00.000Z',
  phone: '',
  confirmed_at: '2024-01-01T00:00:00.000Z',
  last_sign_in_at: '2024-01-01T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'demo-password-123';

// Mutable data tables, reset/seeded between tests via /__mock__/*.
/** @type {Record<string, unknown>[]} */
let folders = [];
/** @type {Record<string, unknown>[]} */
let items = [];
/** @type {Record<string, unknown>[]} */
let projects = [];
/** @type {Record<string, unknown>[]} */
let epics = [];
/** @type {Record<string, unknown>[]} */
let codeItems = [];
/** @type {Record<string, unknown>[]} */
let weeklyPlans = [];
/** @type {Record<string, unknown>[]} */
let habits = [];
/** @type {Record<string, unknown>[]} */
let habitEntries = [];
// The global Backlog priority sequence (migration 0005's `code_priority_seq`): a code_item
// seeded/created without an explicit priority appends at the bottom. Recomputed after each seed.
let nextPriority = 1;
// The subtask sort_order sequence (migration 0018's `item_sort_order_seq`): parked high so an
// item created without an explicit sort_order (a new subtask) appends below every seeded row.
let nextSortOrder = 1_000_000;
// The folder sort_order sequence (migration 0024's `folder_sort_order_seq`): likewise parked
// high, so a folder created without an explicit rank appends at the bottom of the sidebar.
let nextFolderSortOrder = 1_000_000;

// ── helpers ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
  // The browser login (createBrowserClient) is the one cross-origin caller; allow
  // every header the supabase client sends so the preflight passes.
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
};

function sendJson(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return;
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return;
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

/** A PostgREST request wants a single object when the Accept header asks for it. */
function wantsObject(req) {
  return (req.headers['accept'] ?? '').includes('application/vnd.pgrst.object');
}

function wantsRepresentation(req) {
  return (req.headers['prefer'] ?? '').includes('return=representation');
}

/**
 * A `.select(…, { count: 'exact' })` request. PostgREST reports the total in a `Content-Range`
 * header rather than the body, and supabase-js reads `count` back off that header — so a mock
 * that omits it hands the caller `count: null` however many rows exist.
 */
function wantsCount(req) {
  return (req.headers['prefer'] ?? '').includes('count=');
}

/**
 * Answer a row read, attaching `Content-Range` when the caller asked for a count.
 *
 * `.select(…, { head: true })` arrives as an HTTP **HEAD**, whose response carries the count in
 * that header and NO body at all — which is the whole point of `head: true`, and why a mock that
 * only routes GET answers it `405` and surfaces as a bare `500` two layers up.
 */
function sendRows(req, res, rows, total) {
  const headers = { ...CORS_HEADERS, 'Content-Type': 'application/json' };
  if (wantsCount(req)) {
    const count = total ?? rows.length;
    headers['Content-Range'] = count === 0 ? `*/0` : `0-${String(count - 1)}/${String(count)}`;
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(JSON.stringify(rows));
}

// ── PostgREST filtering ──────────────────────────────────────────────────────

/**
 * Apply the `column=op.value` filters from the query string: `eq` (id=eq.x), `is`
 * (folder_id=is.null), `in` (habit_id=in.(a,b)), and the `gte`/`lte` range the habit-entry
 * window read uses — dates are `YYYY-MM-DD`, which compares correctly as a string.
 */
function applyFilters(rows, searchParameters) {
  let result = rows;
  const nonFilterKeys = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
  for (const [key, raw] of searchParameters.entries()) {
    if (nonFilterKeys.has(key)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    switch (op) {
      case 'is': {
        const target = value === 'null' ? null : value === 'true';
        result = result.filter((row) => row[key] === target);

        break;
      }
      case 'eq': {
        result = result.filter((row) => String(row[key]) === value);

        break;
      }
      case 'in': {
        // `in.("a","b")` — supabase-js quotes each element, so strip the wrapping parens and
        // any quotes before comparing.
        const members = new Set(
          value
            .replace(/^\(/, '')
            .replace(/\)$/, '')
            .split(',')
            .map((element) => element.replace(/^"/, '').replace(/"$/, '')),
        );
        result = result.filter((row) => members.has(String(row[key])));

        break;
      }
      case 'gte': {
        result = result.filter((row) => String(row[key]) >= value);

        break;
      }
      case 'lte': {
        result = result.filter((row) => String(row[key]) <= value);

        break;
      }
      // No default
    }
  }
  return result;
}

/**
 * Project the columns named in `select`, the way PostgREST does — a handler that asks for
 * `select=id,uploaded_at` must not get the other columns back (here that's the 40 KB `html`
 * of a weekly plan). `*` (or an absent select) returns whole rows. alfred only ever selects
 * plain column lists, so embedded resources aren't modelled.
 */
function applySelect(rows, searchParameters) {
  const select = searchParameters.get('select');
  if (select === null || select.trim() === '' || select.includes('*')) return rows;
  const columns = select
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
}

/**
 * Apply PostgREST's `limit` / `offset` window. Without this a `.limit(1)` read comes back as
 * the whole table, which supabase-js's `.maybeSingle()` then rejects for returning multiple
 * rows — the mock has to narrow the same way the real server does.
 */
function applyRange(rows, searchParameters) {
  const offset = Number(searchParameters.get('offset') ?? '0');
  const limit = searchParameters.get('limit');
  const start = Number.isNaN(offset) ? 0 : offset;
  if (limit === null) return rows.slice(start);
  const count = Number(limit);
  return Number.isNaN(count) ? rows.slice(start) : rows.slice(start, start + count);
}

/**
 * Apply PostgREST's `order`, which may carry several comma-separated terms
 * (`order=sort_order.asc,created_at.asc`). Later terms are applied first and each sort is
 * stable, so the leftmost term ends up dominant — the same precedence the server gives them.
 *
 * A term may also carry an explicit null placement (`sort_order.asc.nullslast`), which is
 * honoured by partitioning the nulls out — comparing them as `''` would sort them first and
 * silently ignore what the caller asked for. Without a marker they keep sorting as `''`.
 */
function applyOrder(rows, searchParameters) {
  const order = searchParameters.get('order');
  if (!order) return rows;
  let result = rows;
  for (const term of order.split(',').toReversed()) {
    const [column, direction, nulls] = term.split('.');
    const rank = nulls === undefined ? result : result.filter((row) => row[column] != null);
    const sorted = rank.toSorted((a, b) => {
      const av = String(a[column] ?? '');
      const bv = String(b[column] ?? '');
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    const ordered = direction === 'desc' ? sorted.toReversed() : sorted;
    if (nulls === undefined) {
      result = ordered;
      continue;
    }
    const missing = result.filter((row) => row[column] == null);
    result = nulls === 'nullsfirst' ? [...missing, ...ordered] : [...ordered, ...missing];
  }
  return result;
}

function tableFor(name) {
  if (name === 'folders') return folders;
  if (name === 'items') return items;
  if (name === 'projects') return projects;
  if (name === 'epics') return epics;
  if (name === 'code_items') return codeItems;
  if (name === 'weekly_plans') return weeklyPlans;
  if (name === 'habits') return habits;
  if (name === 'habit_entries') return habitEntries;
  return;
}

// ── row construction ─────────────────────────────────────────────────────────

function newItem(input) {
  return {
    id: input.id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    title: input.title ?? '',
    notes: input.notes ?? null,
    source_url: input.source_url ?? null,
    raw_capture: input.raw_capture ?? null,
    item_type: input.item_type ?? 'unclassified',
    status: input.status ?? 'active',
    due_date: input.due_date ?? null,
    completed_at: input.completed_at ?? null,
    folder_id: input.folder_id ?? null,
    parent_id: input.parent_id ?? null,
    intended_project_id: input.intended_project_id ?? null,
    intended_epic_id: input.intended_epic_id ?? null,
    priority: input.priority ?? null,
    // Inbox residency (migration 0026): null = still in the Inbox, whatever folder_id holds.
    // The DB fills it with a before-insert trigger, so this mirrors that rule — inherit the
    // parent's residency, else a folder means dispatched, else stay in the Inbox. Only an
    // ABSENT value inherits (`=== undefined`, not `??`): a seed that states `dispatched_at: null`
    // beside a folder is asking for the one state no UI can produce — foldered, still in the
    // Inbox — and `??` would silently stamp it dispatched instead. In Postgres that state is
    // reached by UPDATEing a folder onto an existing Inbox row (the trigger only fills in an
    // absent value at insert); a seed skips straight to the end state.
    dispatched_at:
      input.dispatched_at === undefined ? inheritedDispatchedAt(input) : input.dispatched_at,
    // Classifier provenance (migration 0029): flat, unlike dispatched_at above — no seed here has
    // been classified, so there is nothing to derive; undefined/null/0 is simply correct.
    classified_at: input.classified_at ?? null,
    classified_provider: input.classified_provider ?? null,
    classified_model: input.classified_model ?? null,
    classified_prompt_version: input.classified_prompt_version ?? null,
    classified_guess: input.classified_guess ?? null,
    classify_attempts: input.classify_attempts ?? 0,
    // Manual subtask rank (migration 0018): explicit when seeded, else the next sequence value —
    // parked high so a POST-created row (e.g. a new subtask) appends at the bottom of its group.
    sort_order: input.sort_order ?? nextSortOrder++,
  };
}

/** The residency a new item inherits when the caller didn't state one (migration 0026's trigger). */
function inheritedDispatchedAt(input) {
  if (input.parent_id != null) {
    const parent = items.find((row) => String(row.id) === String(input.parent_id));
    // A missing parent falls through to the folder rule, exactly as the DB trigger does.
    if (parent !== undefined) return parent.dispatched_at ?? null;
  }
  return input.folder_id == null ? null : new Date().toISOString();
}

function newFolder(input) {
  return {
    id: input.id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    name: input.name ?? '',
    // Manual sidebar rank (migration 0024): explicit when seeded, else the next sequence value.
    sort_order: input.sort_order ?? nextFolderSortOrder++,
    // What belongs in this folder (migration 0028); null until the owner writes it.
    description: input.description ?? null,
  };
}

/** An archived week-plan document (migration 0022): the HTML plus when it was uploaded. */
function newWeeklyPlan(input) {
  return {
    id: input.id ?? randomUUID(),
    html: input.html ?? '',
    uploaded_at: input.uploaded_at ?? new Date().toISOString(),
  };
}

/** A habit definition (migration 0023): its criteria blob plus its cadence and allowance. */
function newHabit(input) {
  return {
    id: input.id ?? randomUUID(),
    name: input.name ?? '',
    notes: input.notes ?? null,
    criteria: input.criteria ?? [],
    active_days: input.active_days ?? [1, 2, 3, 4, 5, 6, 7],
    allowance: input.allowance ?? 0,
    started_on: input.started_on ?? new Date().toISOString().slice(0, 10),
    archived_at: input.archived_at ?? null,
    sort_order: input.sort_order ?? null,
    created_at: input.created_at ?? new Date().toISOString(),
  };
}

/** One logged day: the raw results AND the status the route derived and froze from them. */
function newHabitEntry(input) {
  const now = new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    habit_id: input.habit_id ?? null,
    entry_date: input.entry_date ?? now.slice(0, 10),
    status: input.status ?? 'missed',
    results: input.results ?? null,
    note: input.note ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  };
}

// ── Software Factory row constructors (defaults mirror migration 0002). ──

/** A project = a GitHub repo; `ref_seq` is the shared per-project ref counter. */
function newProject(input) {
  return {
    id: input.id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    name: input.name ?? '',
    key: input.key ?? 'ALF',
    repo_owner: input.repo_owner ?? '',
    repo_name: input.repo_name ?? '',
    github_url: input.github_url ?? null,
    ref_seq: input.ref_seq ?? 0,
    // What this project is and what work belongs in it (migration 0028).
    description: input.description ?? null,
  };
}

/** An epic = an organizing bucket; its `ref` is drawn from the project counter. */
function newEpic(input) {
  return {
    id: input.id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    project_id: input.project_id ?? null,
    name: input.name ?? '',
    notes: input.notes ?? null,
    ref_number: input.ref_number ?? 0,
    ref: input.ref ?? '',
    archived_at: input.archived_at ?? null,
    // The epic-spec columns the webhook Worker writes (never the browser). Null until an
    // epic-refinement PR merges.
    spec_path: input.spec_path ?? null,
    spec_sha: input.spec_sha ?? null,
    spec_markdown: input.spec_markdown ?? null,
    refinement_pr_url: input.refinement_pr_url ?? null,
  };
}

/** A code story: the 1:1 `code_items` sidecar on an `items` row. */
function newCodeItem(input) {
  const now = new Date().toISOString();
  return {
    item_id: input.item_id ?? randomUUID(),
    project_id: input.project_id ?? null,
    epic_id: input.epic_id ?? null,
    ref_number: input.ref_number ?? 0,
    ref: input.ref ?? '',
    factory_state: input.factory_state ?? 'needs_refinement',
    lane: input.lane ?? 'human',
    spec_path: input.spec_path ?? null,
    spec_sha: input.spec_sha ?? null,
    spec_markdown: input.spec_markdown ?? null,
    refinement_pr_url: input.refinement_pr_url ?? null,
    implementation_pr_url: input.implementation_pr_url ?? null,
    blocked_reason: input.blocked_reason ?? null,
    blocked_from: input.blocked_from ?? null,
    // Whether the story still needs a spec (migration 0025). `default true` in the DB, so a
    // seeded/created row needs refinement unless it explicitly says otherwise.
    requires_refinement: input.requires_refinement ?? true,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    // Global Backlog rank (migration 0005): explicit when seeded, else the next sequence value.
    priority: input.priority ?? nextPriority++,
  };
}

/**
 * The priority landing a new story at the top of `projectId` without displacing any other
 * project's stories — mirrors migration 0016's `top_of_project_priority`: the midpoint between
 * the project's best OUTSTANDING rank and whichever row (any project, any status) sits just
 * above it; a project with no outstanding story falls back to one below the global minimum.
 */
function topOfProjectPriority(projectId) {
  const outstanding = codeItems
    .filter(
      (row) =>
        String(row.project_id) === String(projectId) &&
        row.factory_state !== 'done' &&
        row.factory_state !== 'abandoned',
    )
    .map((row) => Number(row.priority));
  if (outstanding.length === 0) {
    const all = codeItems.map((row) => Number(row.priority));
    return (all.length === 0 ? 0 : Math.min(...all)) - 1;
  }
  const best = Math.min(...outstanding);
  const above = codeItems.map((row) => Number(row.priority)).filter((p) => p < best);
  return above.length === 0 ? best - 1 : (Math.max(...above) + best) / 2;
}

/** Park `nextPriority` past every existing rank so appends land at the bottom (mirrors setval). */
function syncPrioritySequence() {
  let max = 0;
  for (const code of codeItems) max = Math.max(max, Number(code.priority) || 0);
  nextPriority = max + 1;
}

/**
 * Set one code_item's priority, enforcing the IMMEDIATE unique index `code_items_priority_key`
 * the way Postgres does — reject if any OTHER row already holds the new value. This is what makes
 * the swap RPC a faithful model: a sequence that ever assigns a value still held by another row
 * throws here, exactly as the live DB 409s. Throws on collision; the caller maps it to a 409.
 */
function setPriorityImmediate(target, value) {
  if (codeItems.some((row) => row !== target && row.priority === value)) {
    throw new Error(`duplicate key value violates unique constraint "code_items_priority_key"`);
  }
  target.priority = value;
}

/** Build a function that picks the right row constructor for a real table. */
function rowConstructorFor(name) {
  if (name === 'folders') return newFolder;
  if (name === 'items') return newItem;
  if (name === 'projects') return newProject;
  if (name === 'epics') return newEpic;
  if (name === 'code_items') return newCodeItem;
  if (name === 'weekly_plans') return newWeeklyPlan;
  if (name === 'habits') return newHabit;
  if (name === 'habit_entries') return newHabitEntry;
  return;
}

/** Ids of an item plus every descendant (matches the DB parent_id cascade). */
function subtreeIds(rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parent_id !== null && ids.has(item.parent_id) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

// ── Computed views (migration 0002) ─────────────────────────────────────────
// These are derived on read from the real arrays, never stored.

/**
 * The `task_items` view: items NOT in the factory — i.e. items with no
 * `code_items` sidecar (matches the migration's `not exists` predicate). Returns
 * the full `items` shape so the same filters/order apply as a plain `items` read.
 */
function taskItemsRows() {
  const inFactory = new Set(codeItems.map((code) => code.item_id));
  return items.filter((item) => !inFactory.has(item.id));
}

/**
 * The `v_code_stories` view: each `code_items` row joined to its `items`,
 * `projects`, and `epics` rows, flattened to EXACTLY the columns the migration's
 * view selects (renamed timestamps and the joined project/epic fields). Rows whose
 * joins don't resolve are dropped, mirroring the view's inner joins.
 */
function codeStoryRows() {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const epicById = new Map(epics.map((epic) => [epic.id, epic]));
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (const code of codeItems) {
    const item = itemById.get(code.item_id);
    const project = projectById.get(code.project_id);
    const epic = epicById.get(code.epic_id);
    // Drop rows whose joins don't resolve (mirrors the view's inner joins).
    if ([item, project, epic].includes(undefined)) continue;
    rows.push({
      item_id: code.item_id,
      project_id: code.project_id,
      epic_id: code.epic_id,
      ref_number: code.ref_number,
      ref: code.ref,
      factory_state: code.factory_state,
      lane: code.lane,
      spec_path: code.spec_path,
      spec_sha: code.spec_sha,
      spec_markdown: code.spec_markdown,
      refinement_pr_url: code.refinement_pr_url,
      implementation_pr_url: code.implementation_pr_url,
      blocked_reason: code.blocked_reason,
      blocked_from: code.blocked_from,
      code_created_at: code.created_at,
      code_updated_at: code.updated_at,
      priority: code.priority,
      title: item.title,
      notes: item.notes,
      source_url: item.source_url,
      item_created_at: item.created_at,
      project_key: project.key,
      project_name: project.name,
      repo_owner: project.repo_owner,
      repo_name: project.repo_name,
      epic_name: epic.name,
      epic_ref: epic.ref,
      epic_archived_at: epic.archived_at,
      epic_spec_path: epic.spec_path ?? null,
      requires_refinement: code.requires_refinement ?? true,
    });
  }
  return rows;
}

/** Resolve a computed view name to its derived rows, or undefined if not a view. */
function viewRows(name) {
  if (name === 'task_items') return taskItemsRows();
  if (name === 'v_code_stories') return codeStoryRows();
  return;
}

// ── route handlers ─────────────────────────────────────────────────────────

function handleAuth(req, res, url, body) {
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const grantType = url.searchParams.get('grant_type');
    if (grantType === 'password' && (body?.email !== USER.email || body?.password !== PASSWORD)) {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      });
      return;
    }
    // password or refresh_token both mint a fresh, long-lived session.
    sendJson(res, 200, makeSession());
    return;
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    const auth = req.headers['authorization'] ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7).length === 0) {
      sendJson(res, 401, { code: 401, message: 'invalid claim: missing sub claim' });
      return;
    }
    // Any non-empty access token we minted maps to the single user.
    sendJson(res, 200, USER);
    return;
  }
  if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
    sendNoContent(res);
    return;
  }
  sendJson(res, 404, { message: `No auth route: ${req.method} ${url.pathname}` });
}

function makeSession() {
  const expiresIn = 60 * 60 * 24 * 365; // far-future so it never expires mid-test
  return {
    access_token: `mock-access-${randomUUID()}`,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `mock-refresh-${randomUUID()}`,
    user: USER,
  };
}

/**
 * Allocate the next ref number for a project: increment its `ref_seq` and return
 * the new value. Mirrors the `next_code_ref` SQL (the shared epic+story counter).
 * Returns undefined if the project doesn't exist.
 */
function allocateRef(projectId) {
  const project = projects.find((row) => String(row.id) === String(projectId));
  if (project === undefined) return;
  project.ref_seq = Number(project.ref_seq) + 1;
  return project.ref_seq;
}

function handleRpc(req, res, fn, body) {
  if (fn === 'complete_subtree' && req.method === 'POST') {
    const rootId = body?.root_id;
    const ids = subtreeIds(rootId);
    const now = new Date().toISOString();
    const affected = [];
    for (const item of items) {
      if (ids.has(item.id)) {
        item.status = 'completed';
        item.completed_at = now;
        affected.push(item);
      }
    }
    sendJson(res, 200, affected);
    return;
  }

  // ── Software Factory RPCs (migration 0002) ──
  if (fn === 'next_code_ref' && req.method === 'POST') {
    const n = allocateRef(body?.p_project);
    // A scalar-returning RPC sends the bare value.
    sendJson(res, 200, n ?? null);
    return;
  }

  if (fn === 'create_epic' && req.method === 'POST') {
    const project = projects.find((row) => String(row.id) === String(body?.p_project));
    const key = project?.key ?? null;
    const n = allocateRef(body?.p_project);
    const epic = newEpic({
      project_id: body?.p_project,
      name: body?.p_name,
      ref_number: n,
      ref: `${key}-${String(n)}`,
    });
    epics.push(epic);
    sendJson(res, 200, epic);
    return;
  }

  if (fn === 'enter_code_module' && req.method === 'POST') {
    const project = projects.find((row) => String(row.id) === String(body?.p_project));
    const key = project?.key ?? null;
    const n = allocateRef(body?.p_project);
    // Flip the item to `code` and clear task-only fields (the DB CHECK constraint).
    const item = items.find((row) => String(row.id) === String(body?.p_item));
    if (item !== undefined) {
      item.item_type = 'code';
      item.due_date = null;
      item.parent_id = null;
      item.status = 'active';
      item.completed_at = null;
      // The gate consumes the item, so it leaves the Inbox (migration 0026).
      item.dispatched_at = new Date().toISOString();
    }
    const code = newCodeItem({
      item_id: body?.p_item,
      project_id: body?.p_project,
      epic_id: body?.p_epic,
      ref_number: n,
      ref: `${key}-${String(n)}`,
    });
    codeItems.push(code);
    sendJson(res, 200, code);
    return;
  }

  // Create a brand-new story from the board's `+` (migration 0004, extended by 0025): insert a
  // fresh `items` row AND its sidecar in one step. `p_requires_refinement` decides where it
  // lands — Needs Refinement when set (the default), Ready for Dev when the New Story dialog's
  // checkbox is cleared.
  if (fn === 'create_code_story' && req.method === 'POST') {
    const project = projects.find((row) => String(row.id) === String(body?.p_project));
    const key = project?.key ?? null;
    const n = allocateRef(body?.p_project);
    const item = newItem({
      title: body?.p_title ?? '',
      notes: body?.p_notes ?? null,
      item_type: 'code',
    });
    items.push(item);
    const requiresRefinement = body?.p_requires_refinement ?? true;
    const code = newCodeItem({
      item_id: item.id,
      project_id: body?.p_project,
      epic_id: body?.p_epic,
      ref_number: n,
      ref: `${key}-${String(n)}`,
      requires_refinement: requiresRefinement,
      factory_state: requiresRefinement ? 'needs_refinement' : 'ready_for_dev',
      priority: topOfProjectPriority(body?.p_project),
    });
    codeItems.push(code);
    sendJson(res, 200, code);
    return;
  }

  // The epic conversion (migration 0019 / ALF-129): the parent becomes a NEW epic (its title
  // + notes), each ACTIVE child becomes a story at the top of the project's Backlog in display
  // order (the bottom-up walk — each top_of_project_priority call lands the next child above
  // the previous one), and the parent is consumed (a task completes, anything else deletes).
  if (fn === 'convert_to_code_epic' && req.method === 'POST') {
    const parent = items.find((row) => String(row.id) === String(body?.p_item));
    if (parent === undefined) {
      sendJson(res, 400, { message: `convert_to_code_epic: item not found (${body?.p_item})` });
      return;
    }
    const project = projects.find((row) => String(row.id) === String(body?.p_project));
    const key = project?.key ?? null;
    const epicN = allocateRef(body?.p_project);
    const epic = newEpic({
      project_id: body?.p_project,
      name: parent.title,
      notes: parent.notes,
      ref_number: epicN,
      ref: `${key}-${String(epicN)}`,
    });
    epics.push(epic);
    const children = items
      .filter((row) => row.parent_id === parent.id && row.status === 'active')
      .toSorted((a, b) => Number(b.sort_order) - Number(a.sort_order));
    const stories = [];
    for (const child of children) {
      const n = allocateRef(body?.p_project);
      const priority = topOfProjectPriority(body?.p_project);
      child.item_type = 'code';
      child.due_date = null;
      child.parent_id = null;
      child.status = 'active';
      child.completed_at = null;
      // Converting consumes the child, so it leaves the Inbox (migration 0026).
      child.dispatched_at = new Date().toISOString();
      const code = newCodeItem({
        item_id: child.id,
        project_id: body?.p_project,
        epic_id: epic.id,
        ref_number: n,
        ref: `${key}-${String(n)}`,
        priority,
      });
      codeItems.push(code);
      // Prepend, so the array comes back in display order (first child highest).
      stories.unshift(code);
    }
    if (parent.item_type === 'task') {
      parent.status = 'completed';
      parent.completed_at = new Date().toISOString();
    } else {
      items = items.filter((row) => row.id !== parent.id);
    }
    sendJson(res, 200, { epic, stories });
    return;
  }

  // Swap two stories' global priority (migration 0005/0006 — the Backlog chevron reorder).
  // Modelled faithfully: `code_items_priority_key` is a NON-deferrable unique index, so Postgres
  // checks uniqueness PER ROW as each row is updated. A naive `a := b; b := a` therefore 409s
  // mid-swap (two rows momentarily share a priority) — the exact production bug. So set each row
  // through `setPriorityImmediate`, which rejects a transient duplicate, and use the same
  // negative-sentinel sequence the fixed RPC does so every per-row step is unique.
  if (fn === 'swap_code_priority' && req.method === 'POST') {
    const a = codeItems.find((row) => row.ref === body?.p_a);
    const b = codeItems.find((row) => row.ref === body?.p_b);
    if (a === undefined || b === undefined) {
      sendJson(res, 400, {
        message: `swap_code_priority: unknown ref (${body?.p_a} / ${body?.p_b})`,
      });
      return;
    }
    const aPriority = a.priority;
    const bPriority = b.priority;
    try {
      setPriorityImmediate(a, -aPriority); // park p_a negative, vacating a_pri
      setPriorityImmediate(b, aPriority); //  p_b takes a_pri (now free)
      setPriorityImmediate(a, bPriority); //  p_a lands on b_pri (vacated by p_b)
    } catch (error) {
      // Mirror the PostgREST 409 the real unique index raises on a transient duplicate.
      sendJson(res, 409, { message: error instanceof Error ? error.message : 'duplicate key' });
      return;
    }
    sendJson(res, 200, [a, b]);
    return;
  }

  // Jump a story to the top/bottom of the global Backlog (migration 0009 — the double-chevron
  // move). Re-rank it one step beyond the current extreme (min-1 / max+1 over the OTHER rows), a
  // single-row write outside the live range, so the unique index never sees a transient duplicate.
  if (fn === 'move_code_priority' && req.method === 'POST') {
    const target = codeItems.find((row) => row.ref === body?.p_ref);
    if (target === undefined) {
      sendJson(res, 400, { message: `move_code_priority: unknown ref (${body?.p_ref})` });
      return;
    }
    const others = codeItems.filter((row) => row !== target).map((row) => row.priority);
    target.priority = body?.p_to_top
      ? (others.length === 0 ? 0 : Math.min(...others)) - 1
      : (others.length === 0 ? 0 : Math.max(...others)) + 1;
    sendJson(res, 200, [target]);
    return;
  }

  // Jump a story to the top/bottom of ITS OWN PROJECT (ALF-110 — the repurposed double-chevron).
  // Mirrors `move_code_priority_in_project`'s midpoint math: insert between the project's current
  // best/worst OUTSTANDING OTHER story and whichever OTHER row sits just past it, so no other
  // project's ranks ever change. The project extreme excludes done/abandoned (ALF-120) — a hidden
  // completed story must not define the top/bottom of the project.
  if (fn === 'move_code_priority_in_project' && req.method === 'POST') {
    const target = codeItems.find((row) => row.ref === body?.p_ref);
    if (target === undefined) {
      sendJson(res, 400, {
        message: `move_code_priority_in_project: unknown ref (${body?.p_ref})`,
      });
      return;
    }
    const others = codeItems.filter((row) => row !== target);
    const projectOthers = others
      .filter(
        (row) =>
          row.project_id === target.project_id &&
          row.factory_state !== 'done' &&
          row.factory_state !== 'abandoned',
      )
      .map((row) => row.priority);
    const allOthers = others.map((row) => row.priority);
    if (projectOthers.length === 0) {
      target.priority = body?.p_to_top
        ? (allOthers.length === 0 ? 0 : Math.min(...allOthers)) - 1
        : (allOthers.length === 0 ? 0 : Math.max(...allOthers)) + 1;
    } else if (body?.p_to_top) {
      const extreme = Math.min(...projectOthers);
      const above = allOthers.filter((p) => p < extreme);
      target.priority = above.length === 0 ? extreme - 1 : (Math.max(...above) + extreme) / 2;
    } else {
      const extreme = Math.max(...projectOthers);
      const below = allOthers.filter((p) => p > extreme);
      target.priority = below.length === 0 ? extreme + 1 : (Math.min(...below) + extreme) / 2;
    }
    sendJson(res, 200, [target]);
    return;
  }

  sendJson(res, 404, { message: `No rpc: ${fn}` });
}

function handleRest(req, res, url, body) {
  const rest = url.pathname.slice('/rest/v1/'.length);

  if (rest.startsWith('rpc/')) {
    handleRpc(req, res, rest.slice('rpc/'.length), body);
    return;
  }

  // Computed views are read-only and derived on demand (not stored arrays).
  const view = viewRows(rest);
  if (view !== undefined) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { message: `View is read-only: ${rest}` });
      return;
    }
    const rows = applySelect(
      applyRange(
        applyOrder(applyFilters(view, url.searchParams), url.searchParams),
        url.searchParams,
      ),
      url.searchParams,
    );
    sendJson(res, 200, wantsObject(req) ? (rows[0] ?? null) : rows);
    return;
  }

  const table = tableFor(rest);
  if (table === undefined) {
    sendJson(res, 404, { message: `No table: ${rest}` });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const matched = applyFilters(table, url.searchParams);
    const rows = applySelect(
      applyRange(applyOrder(matched, url.searchParams), url.searchParams),
      url.searchParams,
    );
    // A single-object read has no count to report, so it keeps the plain JSON path.
    if (req.method === 'GET' && wantsObject(req)) {
      sendJson(res, 200, rows[0] ?? null);
      return;
    }
    // The count is of everything the FILTERS matched, before any range window.
    sendRows(req, res, rows, matched.length);
    return;
  }

  if (req.method === 'POST') {
    const construct = rowConstructorFor(rest);
    const inputs = Array.isArray(body) ? body : [body];
    // An upsert arrives as a POST carrying `Prefer: resolution=merge-duplicates` and the
    // conflict target in `on_conflict` — that is how supabase-js sends `.upsert()`, and it is
    // the entries route's entire write path (log a day, correct a day: same call).
    const merge = (req.headers['prefer'] ?? '').includes('resolution=merge-duplicates');
    const conflictColumns = (url.searchParams.get('on_conflict') ?? '')
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    const created = inputs.map((input) => {
      const existing =
        merge && conflictColumns.length > 0
          ? table.find((row) =>
              conflictColumns.every((column) => String(row[column]) === String(input[column])),
            )
          : undefined;
      if (existing !== undefined) {
        Object.assign(existing, input);
        return existing;
      }
      const row = construct === undefined ? { ...input } : construct(input);
      table.push(row);
      return row;
    });
    if (!wantsRepresentation(req)) {
      sendNoContent(res);
      return;
    }
    const projected = applySelect(created, url.searchParams);
    sendJson(res, 201, wantsObject(req) ? projected[0] : projected);
    return;
  }

  if (req.method === 'PATCH') {
    const matched = applyFilters(table, url.searchParams);
    const now = new Date().toISOString();
    for (const row of matched) {
      // Migration 0029's two triggers (the human-edit claim rule on items, and the
      // dispatch-time correction-log diff) are deliberately NOT reproduced here — the JS mock
      // can't reproduce real-Postgres trigger semantics, same call the residency and epic-hint
      // stories made; that behaviour is proven by the database package's real-Postgres
      // integration suite instead. This assignment stays a flat passthrough.
      Object.assign(row, body);
      // code_items bumps updated_at on every write (mirrors the table trigger).
      if (rest === 'code_items') row.updated_at = now;
    }
    if (!wantsRepresentation(req)) {
      sendNoContent(res);
      return;
    }
    const projected = applySelect(matched, url.searchParams);
    sendJson(res, 200, wantsObject(req) ? (projected[0] ?? null) : projected);
    return;
  }

  if (req.method === 'DELETE') {
    const matched = applyFilters(table, url.searchParams);
    deleteRows(rest, matched);
    sendNoContent(res);
    return;
  }

  sendJson(res, 405, { message: `Method not allowed: ${req.method}` });
}

/**
 * Delete the matched rows of `rest`, honouring migration 0002's FK cascades:
 * items → its subtree + each item's code_items (on delete cascade); folders →
 * items return to the Inbox (on delete set null, plus migration 0026's before-delete
 * trigger clearing their residency); projects → their epics + code_items (on delete
 * cascade). epics/code_items delete only themselves.
 */
function deleteRows(rest, matched) {
  if (rest === 'folders') {
    const removeIds = new Set(matched.map((row) => row.id));
    for (const item of items) {
      if (removeIds.has(item.folder_id)) {
        item.folder_id = null;
        // Losing the folder used to BE returning to the Inbox; now residency is its own column
        // and has to be cleared too, or the item renders in no view at all (migration 0026).
        item.dispatched_at = null;
      }
    }
    folders = folders.filter((folder) => !removeIds.has(folder.id));
    return;
  }
  if (rest === 'items') {
    const removeIds = new Set();
    for (const row of matched) for (const id of subtreeIds(row.id)) removeIds.add(id);
    items = items.filter((item) => !removeIds.has(item.id));
    codeItems = codeItems.filter((code) => !removeIds.has(code.item_id));
    return;
  }
  if (rest === 'projects') {
    const removeIds = new Set(matched.map((row) => row.id));
    epics = epics.filter((epic) => !removeIds.has(epic.project_id));
    codeItems = codeItems.filter((code) => !removeIds.has(code.project_id));
    projects = projects.filter((project) => !removeIds.has(project.id));
    return;
  }
  if (rest === 'epics') {
    const removeRows = new Set(matched);
    epics = epics.filter((epic) => !removeRows.has(epic));
    return;
  }
  if (rest === 'code_items') {
    const removeRows = new Set(matched);
    codeItems = codeItems.filter((code) => !removeRows.has(code));
    return;
  }
  if (rest === 'weekly_plans') {
    const removeRows = new Set(matched);
    weeklyPlans = weeklyPlans.filter((plan) => !removeRows.has(plan));
    return;
  }
  if (rest === 'habits') {
    // The FK cascades a habit's entries with it (migration 0023).
    const removeIds = new Set(matched.map((row) => row.id));
    habitEntries = habitEntries.filter((entry) => !removeIds.has(entry.habit_id));
    habits = habits.filter((habit) => !removeIds.has(habit.id));
    return;
  }
  if (rest === 'habit_entries') {
    const removeRows = new Set(matched);
    habitEntries = habitEntries.filter((entry) => !removeRows.has(entry));
  }
}

function handleControl(req, res, url, body) {
  if (url.pathname === '/__mock__/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__mock__/reset' && req.method === 'POST') {
    folders = [];
    items = [];
    projects = [];
    epics = [];
    codeItems = [];
    weeklyPlans = [];
    habits = [];
    habitEntries = [];
    nextPriority = 1;
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__mock__/seed' && req.method === 'POST') {
    nextPriority = 1;
    folders = Array.isArray(body?.folders) ? body.folders.map((f) => newFolder(f)) : [];
    items = Array.isArray(body?.items) ? body.items.map((i) => newItem(i)) : [];
    projects = Array.isArray(body?.projects) ? body.projects.map((p) => newProject(p)) : [];
    epics = Array.isArray(body?.epics) ? body.epics.map((e) => newEpic(e)) : [];
    codeItems = Array.isArray(body?.codeItems) ? body.codeItems.map((c) => newCodeItem(c)) : [];
    weeklyPlans = Array.isArray(body?.weeklyPlans)
      ? body.weeklyPlans.map((w) => newWeeklyPlan(w))
      : [];
    habits = Array.isArray(body?.habits) ? body.habits.map((h) => newHabit(h)) : [];
    habitEntries = Array.isArray(body?.habitEntries)
      ? body.habitEntries.map((e) => newHabitEntry(e))
      : [];
    // Park the sequence above every seeded rank so gate-created stories append at the bottom.
    syncPrioritySequence();
    sendJson(res, 200, {
      folders,
      items,
      projects,
      epics,
      codeItems,
      weeklyPlans,
      habits,
      habitEntries,
    });
    return;
  }
  if (url.pathname === '/__mock__/state' && req.method === 'GET') {
    sendJson(res, 200, {
      folders,
      items,
      projects,
      epics,
      codeItems,
      weeklyPlans,
      habits,
      habitEntries,
    });
    return;
  }
  sendJson(res, 404, { message: `No control route: ${req.method} ${url.pathname}` });
}

// ── server ───────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(PORT)}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const noBody = new Set(['GET', 'HEAD', 'DELETE']);
    const body = noBody.has(req.method ?? '') ? undefined : await readBody(req);

    try {
      if (url.pathname.startsWith('/__mock__/')) {
        handleControl(req, res, url, body);
      } else if (url.pathname.startsWith('/auth/v1/')) {
        handleAuth(req, res, url, body);
      } else if (url.pathname.startsWith('/rest/v1/')) {
        handleRest(req, res, url, body);
      } else {
        sendJson(res, 404, { message: `Not found: ${req.method} ${url.pathname}` });
      }
    } catch (error) {
      sendJson(res, 500, { message: error instanceof Error ? error.message : 'mock error' });
    }
  })();
});

server.listen(PORT, () => {
  process.stdout.write(`mock-supabase listening on http://localhost:${String(PORT)}\n`);
});
