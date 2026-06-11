/**
 * Shared constants + seed builders for the Playwright integration suite.
 *
 * The mock Supabase backend (scripts/mock-supabase.mjs) and these tests must agree
 * on the port and the single-user credentials. The mock reads the same defaults
 * from its own env, so keeping them in sync here is enough.
 */
import path from 'node:path';
import process from 'node:process';

import type { Folder, Item } from '@/lib/types';

export const MOCK_PORT = 54_331;
export const MOCK_URL = `http://localhost:${String(MOCK_PORT)}`;

// Resolved against the Playwright working directory (frontend/, where the config
// lives). Avoids import.meta, which Playwright's CJS config loader can't transpile.
export const AUTH_FILE = path.join(process.cwd(), 'e2e', '.auth', 'user.json');

export const E2E_USER = {
  email: 'demo@alfred.test',
  password: 'demo-password-123',
};

/** A seed payload: the rows the mock should hold for a test. */
export interface SeedState {
  folders?: Folder[];
  items?: Item[];
}

let sequence = 0;
/** Stable, increasing ISO timestamps so `order=created_at` is deterministic. */
function nextCreatedAt(): string {
  sequence += 1;
  return new Date(Date.UTC(2024, 0, 1, 0, 0, sequence)).toISOString();
}

/** Reset the timestamp sequence — call before building a fresh seed. */
export function resetSeedClock(): void {
  sequence = 0;
}

export function makeFolder(name: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name,
    created_at: overrides.created_at ?? nextCreatedAt(),
  };
}

export function makeItem(title: string, overrides: Partial<Item> = {}): Item {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    created_at: overrides.created_at ?? nextCreatedAt(),
    title,
    notes: overrides.notes ?? null,
    source_url: overrides.source_url ?? null,
    raw_capture: overrides.raw_capture ?? title,
    item_type: overrides.item_type ?? 'unclassified',
    status: overrides.status ?? 'active',
    due_date: overrides.due_date ?? null,
    completed_at: overrides.completed_at ?? null,
    folder_id: overrides.folder_id ?? null,
    parent_id: overrides.parent_id ?? null,
  };
}
