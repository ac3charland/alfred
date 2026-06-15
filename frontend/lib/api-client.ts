/**
 * Thin typed client for alfred's internal API routes.
 *
 * All calls go through fetch() to the /api/* routes (cookie-authed via the
 * browser session). After any mutation, call router.refresh() in the component
 * to pull fresh data from the server.
 */
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

export interface ListItemsQuery {
  folder?: string;
  inbox?: boolean;
  status?: 'active' | 'completed' | 'all';
}

export function listItems(query: ListItemsQuery = {}): Promise<Item[]> {
  const parameters = new URLSearchParams();
  if (query.folder !== undefined) parameters.set('folder', query.folder);
  if (query.inbox === true) parameters.set('inbox', 'true');
  if (query.status !== undefined) parameters.set('status', query.status);
  const qs = parameters.toString();
  return apiRequest<Item[]>(`/api/items${qs ? `?${qs}` : ''}`);
}

export interface CreateItemInput {
  title?: string;
  text?: string;
  notes?: string;
  source_url?: string;
  raw_capture?: string;
  item_type?: 'unclassified' | 'task' | 'code' | 'knowledge';
  due_date?: string;
  folder_id?: string;
  parent_id?: string;
}

export function createItem(input: CreateItemInput): Promise<Item> {
  return apiRequest<Item>('/api/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface UpdateItemInput {
  title?: string;
  // Nullable DB columns accept `null` to CLEAR them (e.g. remove a due date).
  notes?: string | null;
  source_url?: string | null;
  due_date?: string | null;
  folder_id?: string | null;
  parent_id?: string | null;
  item_type?: 'unclassified' | 'task' | 'code' | 'knowledge';
  status?: 'active' | 'completed';
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

export function completeTask(id: string): Promise<Item[]> {
  return apiRequest<Item[]>(`/api/tasks/${id}/complete`, { method: 'POST' });
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
// Software Factory — projects / epics / code stories (the gate, §8 / §14)
// ---------------------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return apiRequest<Project[]>('/api/projects');
}

export interface CreateProjectInput {
  name: string;
  /** The repo URL; the server derives repo_owner/repo_name from it (§4.2). */
  github_url: string;
  /** The 3-char ref-prefix key (validated `^[A-Z][A-Z0-9]{2}$`, §4.2). */
  key: string;
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
 * Patch an epic's header fields (§9.2): `notes` and `archived_at`. Lives in `lib/` (the
 * null-aware layer) because clearing notes / un-archiving sends an explicit `null` — the
 * Postgres absent value — which component code can't mint (unicorn/no-null). Returns the
 * updated `epics` row.
 */
export interface UpdateEpicInput {
  notes?: string | null;
  archived_at?: string | null;
}

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
 * The gate (§8.3): admit an item to the factory. Calls `enter_code_module`, which flips
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

/** Optional extra fields a state transition may carry (e.g. Block sets `blocked_reason`). */
export interface UpdateCodeStateExtra {
  blocked_reason?: string | null;
}

/**
 * Transition a code story to a new factory state (§5.2): the link-click write
 * (`in_refinement` / `in_development`) and M6's manual controls (Block / Abandon /
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
