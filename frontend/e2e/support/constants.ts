/**
 * Shared constants + seed builders for the Playwright integration suite.
 *
 * The mock Supabase backend (scripts/mock-supabase.mjs) and these tests must agree
 * on the port and the single-user credentials. The mock reads the same defaults
 * from its own env, so keeping them in sync here is enough.
 */
import path from 'node:path';
import process from 'node:process';

import type { CodeItem, Epic, Folder, Item, Project } from '@/lib/types';

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
  projects?: Project[];
  epics?: Epic[];
  codeItems?: CodeItem[];
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
    intended_project_id: overrides.intended_project_id ?? null,
    occurrence_index: overrides.occurrence_index ?? null,
    priority: overrides.priority ?? null,
    recurrence: overrides.recurrence ?? null,
    recurrence_series_id: overrides.recurrence_series_id ?? null,
  };
}

// ── Software Factory seed builders (mirror makeItem/makeFolder). ──

/** A project = a GitHub repo. `key` is the immutable 3-char ref prefix. */
export function makeProject(name: string, overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    created_at: overrides.created_at ?? nextCreatedAt(),
    name,
    key: overrides.key ?? 'ALF',
    repo_owner: overrides.repo_owner ?? 'ac3charland',
    repo_name: overrides.repo_name ?? 'alfred',
    github_url: overrides.github_url ?? null,
    ref_seq: overrides.ref_seq ?? 0,
  };
}

/** An epic = an organizing bucket; its `ref` is drawn from the project counter. */
export function makeEpic(name: string, overrides: Partial<Epic> = {}): Epic {
  const refNumber = overrides.ref_number ?? 1;
  return {
    id: overrides.id ?? crypto.randomUUID(),
    created_at: overrides.created_at ?? nextCreatedAt(),
    project_id: overrides.project_id ?? crypto.randomUUID(),
    name,
    notes: overrides.notes ?? null,
    ref_number: refNumber,
    ref: overrides.ref ?? `ALF-${String(refNumber)}`,
    archived_at: overrides.archived_at ?? null,
  };
}

/** A code story: the `code_items` sidecar row (1:1 on an `items` row). */
export function makeCodeStory(overrides: Partial<CodeItem> = {}): CodeItem {
  const refNumber = overrides.ref_number ?? 1;
  return {
    item_id: overrides.item_id ?? crypto.randomUUID(),
    project_id: overrides.project_id ?? crypto.randomUUID(),
    epic_id: overrides.epic_id ?? crypto.randomUUID(),
    ref_number: refNumber,
    ref: overrides.ref ?? `ALF-${String(refNumber)}`,
    factory_state: overrides.factory_state ?? 'needs_refinement',
    lane: overrides.lane ?? 'human',
    spec_path: overrides.spec_path ?? null,
    spec_sha: overrides.spec_sha ?? null,
    spec_markdown: overrides.spec_markdown ?? null,
    refinement_pr_url: overrides.refinement_pr_url ?? null,
    implementation_pr_url: overrides.implementation_pr_url ?? null,
    blocked_reason: overrides.blocked_reason ?? null,
    created_at: overrides.created_at ?? nextCreatedAt(),
    updated_at: overrides.updated_at ?? nextCreatedAt(),
    priority: overrides.priority ?? 1,
  };
}
