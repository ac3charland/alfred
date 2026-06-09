/**
 * Thin typed client for alfred's internal API routes.
 *
 * All calls go through fetch() to the /api/* routes (cookie-authed via the
 * browser session). After any mutation, call router.refresh() in the component
 * to pull fresh data from the server.
 */
import type { Folder, Item } from '@/lib/types';

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
  notes?: string;
  source_url?: string;
  due_date?: string;
  folder_id?: string;
  parent_id?: string;
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
