/**
 * Thin typed client for alfred's internal API routes.
 *
 * All calls go through fetch() to the /api/* routes (cookie-authed via the
 * browser session). After any mutation, call router.refresh() in the component
 * to pull fresh data from the server.
 */
// The request-body / query input types are the single source of truth in lib/api/schemas
// (derived from the Zod schemas via z.infer); re-export them so existing importers of
// `@/lib/api-client` keep working without re-declaring the shapes here.
import type {
  AddHandleInput,
  ChangeTierInput,
  ClearMessageInput,
  CommMessagesQuery,
  CreateHabitInput,
  CreateItemInput,
  CreatePersonInput,
  CreateProjectInput,
  CreateRubricVersionInput,
  ListItemsQuery,
  PurgeInput,
  UpdateEpicInput,
  UpdateFolderInput,
  UpdateHabitInput,
  UpdateItemInput,
  UpdatePersonInput,
  UpdateProjectInput,
  UpsertHabitEntryInput,
} from '@/lib/api/schemas';
import type {
  CodeFactoryState,
  CodeItem,
  CodeStory,
  CommCorrection,
  CommHandle,
  CommMessage,
  CommPersonWithHandles,
  CommRubric,
  Epic,
  Folder,
  Habit,
  HabitEntry,
  Item,
  LocVelocityResponse,
  PrRatioResponse,
  Project,
  WeeklyPlan,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A failed request, carrying the pieces a caller can actually act on.
 *
 * Some refusals are real answers rather than faults — a `409` explaining that a habit's cadence
 * is fixed is written to be read by the owner. A bare `Error` forces every form to show a
 * generic "try again", which for those is a lie: retrying can't work. So the status and the
 * server's own sentence travel with the throw.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The `{ error }` sentence from the response envelope, when it carried one. */
    readonly detail: string | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Pull the `{ error }` sentence out of a failed response body, if it is one. */
function readErrorDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const { error } = parsed;
      if (typeof error === 'string' && error !== '') return error;
    }
  } catch {
    // A non-JSON body (an HTML error page, an empty 502) has no sentence to quote.
  }
  return undefined;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // Build headers without spreading HeadersInit (which can be string[][] or Headers,
  // both of which cause @typescript-eslint/no-misused-spread if spread in an object).
  const mergedHeaders = new Headers(init?.headers);
  mergedHeaders.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    ...init,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(
      `API ${init?.method ?? 'GET'} ${path} failed: ${String(response.status)} ${text}`,
      response.status,
      readErrorDetail(text),
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function listItems(query: ListItemsQuery = {}): Promise<Item[]> {
  const parameters = new URLSearchParams();
  if (query.folder !== undefined) parameters.set('folder', query.folder);
  if (query.inbox === true) parameters.set('inbox', 'true');
  if (query.status !== undefined) parameters.set('status', query.status);
  const qs = parameters.toString();
  return apiRequest<Item[]>(`/api/items${qs ? `?${qs}` : ''}`);
}

export function createItem(input: CreateItemInput): Promise<Item> {
  return apiRequest<Item>('/api/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateItem(id: string, input: UpdateItemInput): Promise<Item> {
  return apiRequest<Item>(`/api/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteItem(id: string): Promise<{ success: true }> {
  return apiRequest<{ success: true }>(`/api/items/${id}`, { method: 'DELETE' });
}

/**
 * Move an item to the Inbox: clear its folder AND its residency, in one write.
 *
 * Un-filing undoes the filing rather than remembering it — keeping the folder as a hint would
 * leave the item sitting in the Inbox pre-filled with the very folder its owner just pulled it
 * out of, one press away from going straight back.
 *
 * This function lives in lib/ (the null-aware data layer) because the PATCH
 * body needs `{ folder_id: null }` — null is the Postgres canonical absent value
 * and cannot be sent from component code where unicorn/no-null is enabled.
 */
export function moveToInbox(id: string): Promise<Item> {
  return apiRequest<Item>(`/api/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ folder_id: null, dispatched: false }),
  });
}

/**
 * The result of completing a task: the rows marked completed, plus the next occurrence
 * `spawned` when the task was a recurring one whose series hasn't ended (otherwise `null`).
 */
export interface CompleteTaskResult {
  completed: Item[];
  spawned: Item | null;
}

/**
 * Complete a task and its subtree. The route returns either the plain affected-rows array
 * (non-recurring path, unchanged) or `{ completed, spawned }` (recurring path); both are
 * normalized here to a single {@link CompleteTaskResult} so callers don't branch on the wire
 * shape.
 */
export async function completeTask(id: string): Promise<CompleteTaskResult> {
  const data = await apiRequest<Item[] | { completed: Item[]; spawned: Item | null }>(
    `/api/tasks/${id}/complete`,
    { method: 'POST' },
  );
  return Array.isArray(data)
    ? { completed: data, spawned: null }
    : { completed: data.completed, spawned: data.spawned };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export function listFolders(): Promise<Folder[]> {
  return apiRequest<Folder[]>('/api/folders');
}

export function createFolder(name: string): Promise<Folder> {
  return apiRequest<Folder>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Patch a folder: a rename (`{ name }`), a reorder (`{ sort_order }`), or both. */
export function updateFolder(id: string, input: UpdateFolderInput): Promise<Folder> {
  return apiRequest<Folder>(`/api/folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteFolder(id: string): Promise<{ success: true }> {
  return apiRequest<{ success: true }>(`/api/folders/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

/** Define a habit. Session-only on the server; the app is the only caller. */
export function createHabit(input: CreateHabitInput): Promise<Habit> {
  return apiRequest<Habit>('/api/habits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Change a habit's definition. `archived` is a boolean here too — the server stamps the instant,
 * so the client never states when something was retired.
 */
export function updateHabit(id: string, input: UpdateHabitInput): Promise<Habit> {
  return apiRequest<Habit>(`/api/habits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Destroy a habit and, by cascade, every day logged against it. */
export function deleteHabit(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/habits/${id}`, { method: 'DELETE' });
}

/**
 * Log or correct one day. The server scores `results` against the habit's criteria and returns
 * the row with the status it froze — so the caller never states a verdict, only what happened.
 * `skipped` is the exception, and it carries its reason in `note`.
 *
 * There is no habit READER here: the app reads habits through the shell seed like every other
 * entity, so a client fetch would be a second read path with no caller.
 */
export function upsertHabitEntry(
  habitId: string,
  input: UpsertHabitEntryInput,
): Promise<HabitEntry> {
  return apiRequest<HabitEntry>(`/api/habits/${habitId}/entries`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Software Factory — projects / epics / code stories (the gate)
// ---------------------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return apiRequest<Project[]>('/api/projects');
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiRequest<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Patch a project's description — its only editable field (ALF-179). Lives in `lib/` (the
 * null-aware layer) because clearing the description sends an explicit `null` — the Postgres
 * absent value — which component code can't mint (unicorn/no-null). Returns the updated row.
 */
export function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  return apiRequest<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** List epics, optionally scoped to one project (the board / the gate's Epic selector). */
export function listEpics(projectId?: string): Promise<Epic[]> {
  const qs = projectId === undefined ? '' : `?project=${encodeURIComponent(projectId)}`;
  return apiRequest<Epic[]>(`/api/epics${qs}`);
}

/** Create an epic (the `create_epic` RPC allocates the shared per-project ref). */
export function createEpic(projectId: string, name: string): Promise<Epic> {
  return apiRequest<Epic>('/api/epics', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, name }),
  });
}

/**
 * Patch an epic's header fields: `name`, `notes` and `archived_at`. Lives in `lib/`
 * (the null-aware layer) because clearing notes / un-archiving sends an explicit `null` —
 * the Postgres absent value — which component code can't mint (unicorn/no-null). Returns the
 * updated `epics` row.
 */
export function updateEpic(id: string, input: UpdateEpicInput): Promise<Epic> {
  return apiRequest<Epic>(`/api/epics/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listCode(): Promise<CodeStory[]> {
  return apiRequest<CodeStory[]>('/api/code');
}

/**
 * The gate: admit an item to the factory. Calls `enter_code_module`, which flips
 * `item_type` to `code`, clears the task-only fields, and creates the `code_items`
 * sidecar with a server-allocated ref. Returns the sidecar row.
 *
 * `requiresRefinement` lands the sidecar: `true` at `needs_refinement` as the gate always has,
 * `false` straight in `ready_for_dev` — what a `Bug:` / `Spike:` title gets (ALF-215).
 */
export function enterCodeModule(
  itemId: string,
  projectId: string,
  epicId: string,
  requiresRefinement: boolean,
): Promise<CodeItem> {
  return apiRequest<CodeItem>('/api/code', {
    method: 'POST',
    body: JSON.stringify({
      item_id: itemId,
      project_id: projectId,
      epic_id: epicId,
      requires_refinement: requiresRefinement,
    }),
  });
}

/**
 * Create a brand-new code story from the project view (no inbox item required). Calls
 * `create_code_story`, which inserts a fresh `items` row AND its `code_items` sidecar with a
 * server-allocated ref, returning the sidecar row. `requiresRefinement` is the dialog's "Needs
 * refinement" checkbox: `true` lands the story at `needs_refinement`, `false` straight in
 * `ready_for_dev` with no spec.
 *
 * Lives in `lib/` (the null-aware boundary): an empty notes field is sent as `null` — the
 * Postgres absent value — which component code can't mint (unicorn/no-null).
 */
export function createCodeStory(
  projectId: string,
  epicId: string,
  title: string,
  notes: string | null,
  requiresRefinement: boolean,
): Promise<CodeItem> {
  return apiRequest<CodeItem>('/api/code', {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: notes === '' ? null : notes,
      project_id: projectId,
      epic_id: epicId,
      requires_refinement: requiresRefinement,
    }),
  });
}

/** The result of an epic conversion: the created epic plus its story sidecars in display order. */
export interface ConvertedEpic {
  epic: Epic;
  stories: CodeItem[];
}

/**
 * The epic conversion (ALF-129): turn a 1-deep parent (a code inbox item or a decomposed
 * task) into a NEW epic plus one story per active child via `convert_to_code_epic`. The epic
 * takes the parent's title and notes; the stories land at the top of the project's Backlog in
 * the children's display order; the parent is consumed (a code row deleted, a task completed).
 */
export function convertToCodeEpic(itemId: string, projectId: string): Promise<ConvertedEpic> {
  return apiRequest<ConvertedEpic>('/api/code/epic', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, project_id: projectId }),
  });
}

/**
 * Optional extra fields a state transition may carry: `blocked_reason` (Block) and
 * `requires_refinement` (the refinement mark, which often rides an unchanged `factory_state`).
 */
export interface UpdateCodeStateExtra {
  blocked_reason?: string | null;
  requires_refinement?: boolean;
}

/**
 * Transition a code story to a new factory state: the link-click write
 * (`in_refinement` / `in_development`) and the manual controls (Block / Abandon /
 * Advance-Revert). PATCHes the sidecar by its `ref` and returns the updated row.
 */
export function updateCodeState(
  ref: string,
  factoryState: CodeFactoryState,
  extra: UpdateCodeStateExtra = {},
): Promise<CodeItem> {
  const body: {
    factory_state: CodeFactoryState;
    blocked_reason?: string | null;
    requires_refinement?: boolean;
  } = {
    factory_state: factoryState,
  };
  if (extra.blocked_reason !== undefined) body.blocked_reason = extra.blocked_reason;
  if (extra.requires_refinement !== undefined) body.requires_refinement = extra.requires_refinement;
  return apiRequest<CodeItem>(`/api/code/${encodeURIComponent(ref)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Move a code story to a different epic in the same project. PATCHes the sidecar's
 * `epic_id` by ref and returns the updated `code_items` row. A named, intent-revealing
 * helper (like `moveToInbox`) rather than overloading `updateCodeState`.
 */
export function moveCodeEpic(ref: string, epicId: string): Promise<CodeItem> {
  return apiRequest<CodeItem>(`/api/code/${encodeURIComponent(ref)}`, {
    method: 'PATCH',
    body: JSON.stringify({ epic_id: epicId }),
  });
}

/**
 * Reorder the Backlog: swap two stories' global `priority` (the chevron move). POSTs both refs
 * to the atomic `swap_code_priority` RPC behind `/api/code/reorder` — one statement so the
 * `unique(priority)` index never sees a transient duplicate — and returns the two updated
 * `code_items` rows, which the store reconciles via `codeItemToStoryPatch`.
 */
export async function reorderCode(a: string, b: string): Promise<CodeItem[]> {
  const { rows } = await apiRequest<{ rows: CodeItem[] }>('/api/code/reorder', {
    method: 'POST',
    body: JSON.stringify({ a, b }),
  });
  return rows;
}

/**
 * Jump the Backlog: re-rank one story to the top (`toTop`) or bottom of the global `priority`
 * order (the double-chevron move). POSTs the ref + direction to the atomic `move_code_priority`
 * RPC behind `/api/code/move` — a single-row UPDATE to just beyond the current extreme — and
 * returns the updated `code_items` row, which the store reconciles via `codeItemToStoryPatch`.
 */
export async function moveCode(ref: string, toTop: boolean): Promise<CodeItem[]> {
  const { rows } = await apiRequest<{ rows: CodeItem[] }>('/api/code/move', {
    method: 'POST',
    body: JSON.stringify({ ref, to_top: toTop }),
  });
  return rows;
}

/**
 * Jump within a project (ALF-110): re-rank one story to the top (`toTop`) or bottom of ITS OWN
 * PROJECT's slice of the `priority` order, without disturbing any other project's stories. POSTs
 * the ref + direction to the atomic `move_code_priority_in_project` RPC behind
 * `/api/code/move-project` and returns the updated `code_items` row, reconciled the same way as
 * `moveCode`.
 */
export async function moveCodeInProject(ref: string, toTop: boolean): Promise<CodeItem[]> {
  const { rows } = await apiRequest<{ rows: CodeItem[] }>('/api/code/move-project', {
    method: 'POST',
    body: JSON.stringify({ ref, to_top: toTop }),
  });
  return rows;
}

// ---------------------------------------------------------------------------
// PR ratio
// ---------------------------------------------------------------------------

/**
 * This week's merged-PR split across the configured repos, or `undefined` when the
 * deployment reports the feature unconfigured (501) — which the Backlog card renders as
 * nothing at all, so a deployment without a GitHub token shows a clean Backlog.
 *
 * Deliberately not routed through `apiRequest`: that helper collapses every non-2xx into a
 * thrown Error, and this caller has to tell "not configured here" apart from "GitHub is
 * unhappy", which stays a throw.
 */
export async function getPrRatio(tz?: string): Promise<PrRatioResponse | undefined> {
  const qs = tz === undefined ? '' : `?tz=${encodeURIComponent(tz)}`;
  const path = `/api/code/pr-ratio${qs}`;
  const response = await fetch(path);

  if (response.status === 501) return undefined;
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`API GET ${path} failed: ${String(response.status)} ${text}`);
  }

  return response.json() as Promise<PrRatioResponse>;
}

// ---------------------------------------------------------------------------
// Lines-changed velocity
// ---------------------------------------------------------------------------

/**
 * The three outcomes `GET /api/code/loc-velocity` can hand the card, as a discriminated union
 * rather than `Response | undefined`: this endpoint has a THIRD normal outcome (GitHub is
 * still computing the statistics) that a two-way "the data, or nothing" return can't carry.
 */
export type LocVelocityResult =
  | { status: 'ready'; velocity: LocVelocityResponse }
  | { status: 'unconfigured' }
  | { status: 'computing' };

/**
 * Lines changed per week across the configured repos. Like `getPrRatio`, deliberately not
 * routed through `apiRequest`: that helper collapses every non-2xx into a thrown Error, and
 * this caller has to tell "not configured here" and "not ready yet" apart from "GitHub is
 * unhappy" — which stays a throw.
 */
export async function getLocVelocity(): Promise<LocVelocityResult> {
  const path = '/api/code/loc-velocity';
  const response = await fetch(path);

  if (response.status === 501) return { status: 'unconfigured' };
  if (response.status === 202) return { status: 'computing' };
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`API GET ${path} failed: ${String(response.status)} ${text}`);
  }

  return { status: 'ready', velocity: (await response.json()) as LocVelocityResponse };
}

// ---------------------------------------------------------------------------
// Weekly plans
// ---------------------------------------------------------------------------

/**
 * Fetch one archived weekly plan with its document. Only the latest plan is seeded at the
 * shell, so the picker pulls an older week through here (once — the store caches it).
 *
 * There is no client-side upload counterpart: plans are POSTed straight to
 * `/api/weekly-plans` with the ingress API key, not from the app.
 */
export function fetchWeeklyPlan(id: string): Promise<WeeklyPlan> {
  return apiRequest<WeeklyPlan>(`/api/weekly-plans/${id}`);
}

// ---------------------------------------------------------------------------
// Comms — the communication firewall
//
// Every route returns the row(s) it changed, so a store action reconciles with the
// server-canonical message/person/rubric rather than re-reading the module.
// ---------------------------------------------------------------------------

/**
 * Read one side of the module: the response queue, or the FYI shelf. The shell seeds the
 * store, so this is for the shelf's on-demand paging and for reconciling a long-lived tab —
 * the queue is never fetched to render it.
 */
export function fetchCommMessages(query: CommMessagesQuery): Promise<CommMessage[]> {
  const search = new URLSearchParams({ scope: query.scope });
  if (query.limit !== undefined) search.set('limit', String(query.limit));
  return apiRequest<CommMessage[]>(`/api/comms/messages?${search.toString()}`);
}

/**
 * Clear a queued message by one of the owner's two clearing verbs. They are separate because
 * only `nothing_to_answer` is a correction — it says the row should never have been queued and
 * is recorded as an example; `not_replying` says the model was right and the owner is declining.
 */
export function clearCommMessage(
  id: string,
  exit: ClearMessageInput['exit'],
): Promise<CommMessage> {
  return apiRequest<CommMessage>(`/api/comms/messages/${id}/clear`, {
    method: 'POST',
    body: JSON.stringify({ exit }),
  });
}

/**
 * Override the tier a message landed in. Recorded as a correction, so the example set learns
 * from it — which is why this is its own endpoint rather than a generic message PATCH.
 */
export function changeCommTier(id: string, tier: ChangeTierInput['tier']): Promise<CommMessage> {
  return apiRequest<CommMessage>(`/api/comms/messages/${id}/tier`, {
    method: 'POST',
    body: JSON.stringify({ tier }),
  });
}

/**
 * Spin the obligation off into an Inbox item, which clears the message at that moment — the
 * third way out of the queue. Both rows come back: the item so the tasks store can hold it, and
 * the message so the queue drops it.
 */
export function makeInboxItemFromMessage(
  id: string,
): Promise<{ message: CommMessage; item: Item }> {
  return apiRequest<{ message: CommMessage; item: Item }>(`/api/comms/messages/${id}/inbox-item`, {
    method: 'POST',
  });
}

/**
 * Ask for one message to be judged again. Nothing is ever re-judged silently — editing the
 * rubric, the roster or the example set sweeps nothing — so a re-run is always an explicit act
 * on an explicit row. The response is the message carrying its pending request; the new verdict
 * arrives later over the realtime stream.
 */
export function requestReclassify(id: string): Promise<CommMessage> {
  return apiRequest<CommMessage>(`/api/comms/messages/${id}/reclassify`, { method: 'POST' });
}

/**
 * The deliberate "I want this gone": destroy one message, one account's messages, or everything
 * before a date. Unlike the 60-day retention sweep this DOES cascade into the example set,
 * stripping the denormalised text from the corrections it reaches. Returns how many messages
 * were destroyed.
 */
export function purgeComms(input: PurgeInput): Promise<{ purged: number }> {
  return apiRequest<{ purged: number }>('/api/comms/purge', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Add someone to the roster, with however many handles are known so far. */
export function createCommPerson(input: CreatePersonInput): Promise<CommPersonWithHandles> {
  return apiRequest<CommPersonWithHandles>('/api/comms/people', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Rename someone, change their priority, or edit the note. Handles are never touched here —
 * they are added and removed one at a time, so a rename can't silently drop an address.
 */
export function updateCommPerson(
  id: string,
  input: UpdatePersonInput,
): Promise<CommPersonWithHandles> {
  return apiRequest<CommPersonWithHandles>(`/api/comms/people/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Remove someone from the roster; their handles cascade with them. */
export function deleteCommPerson(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/comms/people/${id}`, { method: 'DELETE' });
}

/** Give a person one more address or number. The server stores it normalised. */
export function addCommHandle(personId: string, input: AddHandleInput): Promise<CommHandle> {
  return apiRequest<CommHandle>(`/api/comms/people/${personId}/handles`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Drop one handle. Addressed by the HANDLE's id, not the person's — a handle is unique across
 * the whole roster, so the person is implied.
 */
export function deleteCommHandle(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/comms/handles/${id}`, { method: 'DELETE' });
}

/**
 * Save the rubric. The table is append-only, so this writes a NEW version and returns it —
 * every verdict names the version that produced it, so an edit must not destroy the old text.
 * Saving sweeps nothing: existing verdicts keep the judgment they were given.
 */
export function createCommRubricVersion(input: CreateRubricVersionInput): Promise<CommRubric> {
  return apiRequest<CommRubric>('/api/comms/rubric', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Take a correction out of the prompt's example set, or put it back. The row itself is history
 * and is never destroyed; both directions bump the example-set version, so a verdict stamped
 * with an older version stays reconstructable.
 */
export function pruneCommExample(id: string, pruned: boolean): Promise<CommCorrection> {
  return apiRequest<CommCorrection>(`/api/comms/examples/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pruned }),
  });
}

export {
  type AddHandleInput,
  type ChangeTierInput,
  type ClearMessageInput,
  type CommMessagesQuery,
  type CreateHabitInput,
  type CreateItemInput,
  type CreatePersonInput,
  type CreateProjectInput,
  type CreateRubricVersionInput,
  type ListItemsQuery,
  type PruneExampleInput,
  type PurgeInput,
  type UpdateEpicInput,
  type UpdateHabitInput,
  type UpdateItemInput,
  type UpdatePersonInput,
  type UpdateProjectInput,
  type UpsertHabitEntryInput,
} from '@/lib/api/schemas';
