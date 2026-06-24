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
  CreateItemInput,
  CreateProjectInput,
  ListItemsQuery,
  UpdateEpicInput,
  UpdateItemInput,
} from '@/lib/api/schemas';
import type {
  CodeFactoryState,
  CodeItem,
  CodeStory,
  Epic,
  Folder,
  Item,
  Project,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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
    throw new Error(
      `API ${init?.method ?? 'GET'} ${path} failed: ${String(response.status)} ${text}`,
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
 * Move an item to the Inbox (clears its folder_id to null).
 *
 * This function lives in lib/ (the null-aware data layer) because the PATCH
 * body needs `{ folder_id: null }` — null is the Postgres canonical absent value
 * and cannot be sent from component code where unicorn/no-null is enabled.
 */
export function moveToInbox(id: string): Promise<Item> {
  return apiRequest<Item>(`/api/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ folder_id: null }),
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

export function updateFolder(id: string, name: string): Promise<Folder> {
  return apiRequest<Folder>(`/api/folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteFolder(id: string): Promise<{ success: true }> {
  return apiRequest<{ success: true }>(`/api/folders/${id}`, { method: 'DELETE' });
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
 * sidecar at `needs_refinement` with a server-allocated ref. Returns the sidecar row.
 */
export function enterCodeModule(
  itemId: string,
  projectId: string,
  epicId: string,
): Promise<CodeItem> {
  return apiRequest<CodeItem>('/api/code', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, project_id: projectId, epic_id: epicId }),
  });
}

/**
 * Create a brand-new code story from the project view (no inbox item required). Calls
 * `create_code_story`, which inserts a fresh `items` row AND its `code_items` sidecar at
 * `needs_refinement` with a server-allocated ref, returning the sidecar row.
 *
 * Lives in `lib/` (the null-aware boundary): an empty notes field is sent as `null` — the
 * Postgres absent value — which component code can't mint (unicorn/no-null).
 */
export function createCodeStory(
  projectId: string,
  epicId: string,
  title: string,
  notes: string | null,
): Promise<CodeItem> {
  return apiRequest<CodeItem>('/api/code', {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: notes === '' ? null : notes,
      project_id: projectId,
      epic_id: epicId,
    }),
  });
}

/** Optional extra fields a state transition may carry (e.g. Block sets `blocked_reason`). */
export interface UpdateCodeStateExtra {
  blocked_reason?: string | null;
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
  const body: { factory_state: CodeFactoryState; blocked_reason?: string | null } = {
    factory_state: factoryState,
  };
  if (extra.blocked_reason !== undefined) body.blocked_reason = extra.blocked_reason;
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

export {
  type CreateItemInput,
  type CreateProjectInput,
  type ListItemsQuery,
  type UpdateEpicInput,
  type UpdateItemInput,
} from '@/lib/api/schemas';
