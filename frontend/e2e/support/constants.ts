/**
 * Shared constants + seed builders for the Playwright integration suite.
 *
 * The mock Supabase backend (scripts/mock-supabase.mjs) and these tests must agree
 * on the port and the single-user credentials. The mock reads the same defaults
 * from its own env, so keeping them in sync here is enough.
 */
import path from 'node:path';
import process from 'node:process';

import type {
  CodeItem,
  Epic,
  Folder,
  Habit,
  HabitEntry,
  Item,
  Project,
  WeeklyPlan,
} from '@/lib/types';

export const MOCK_PORT = 54_331;
export const MOCK_URL = `http://localhost:${String(MOCK_PORT)}`;

// Resolved against the Playwright working directory (frontend/, where the config
// lives). Avoids import.meta, which Playwright's CJS config loader can't transpile.
export const AUTH_FILE = path.join(process.cwd(), 'e2e', '.auth', 'user.json');

export const E2E_USER = {
  email: 'demo@alfred.test',
  password: 'demo-password-123',
};

/** The ingest key this deployment is configured with — the credential a keyed caller sends. */
export const INGEST_API_KEY = 'mock_ingest_key';

/** A seed payload: the rows the mock should hold for a test. */
export interface SeedState {
  folders?: Folder[];
  items?: Item[];
  projects?: Project[];
  epics?: Epic[];
  codeItems?: CodeItem[];
  weeklyPlans?: WeeklyPlan[];
  habits?: Habit[];
  habitEntries?: HabitEntry[];
}

let sequence = 0;
/** Stable, increasing ISO timestamps so `order=created_at` is deterministic. */
function nextCreatedAt(): string {
  sequence += 1;
  return new Date(Date.UTC(2024, 0, 1, 0, 0, sequence)).toISOString();
}

let sortSequence = 0;
/** Increasing `sort_order` so a subtask group defaults to creation order (ALF-117), matching the
 *  DB backfill (row_number over created_at). Deterministic and overridable per item. */
function nextSortOrder(): number {
  sortSequence += 1;
  return sortSequence;
}

/** Reset the timestamp + sort_order sequences — call before building a fresh seed. */
export function resetSeedClock(): void {
  sequence = 0;
  sortSequence = 0;
}

export function makeFolder(name: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name,
    created_at: overrides.created_at ?? nextCreatedAt(),
    // Increasing rank, so a seeded folder list defaults to creation order in the sidebar
    // (ALF-153) — matching the DB backfill (row_number over created_at).
    sort_order: overrides.sort_order ?? nextSortOrder(),
    description: overrides.description ?? null,
  };
}

/** An archived week-plan document. `html` is the whole self-contained page, verbatim. */
export function makeWeeklyPlan(html: string, overrides: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    html,
    uploaded_at: overrides.uploaded_at ?? nextCreatedAt(),
  };
}

/**
 * The residency stamp a seeded FILED item carries. A fixed constant, never `new Date()` —
 * fixtures pin the clock rather than read it.
 */
export const DISPATCHED_AT = '2024-01-01T00:00:00.000Z';

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
    // Residency, derived rather than flat: a seed that says `folder_id: 'f1'` means "filed in
    // f1", and filing is what dispatches an item out of the Inbox — so the existing seeds keep
    // meaning what they meant with no edit. Tested against `undefined` rather than `??`, so a
    // seed can state `dispatched_at: null` explicitly and get the one state this story creates:
    // an item that already carries a folder but is still waiting in the Inbox.
    dispatched_at:
      overrides.dispatched_at === undefined
        ? overrides.folder_id == null
          ? null
          : DISPATCHED_AT
        : overrides.dispatched_at,
    parent_id: overrides.parent_id ?? null,
    intended_project_id: overrides.intended_project_id ?? null,
    intended_epic_id: overrides.intended_epic_id ?? null,
    occurrence_index: overrides.occurrence_index ?? null,
    priority: overrides.priority ?? null,
    recurrence: overrides.recurrence ?? null,
    recurrence_series_id: overrides.recurrence_series_id ?? null,
    sort_order: overrides.sort_order ?? nextSortOrder(),
    classified_at: overrides.classified_at ?? null,
    classified_provider: overrides.classified_provider ?? null,
    classified_model: overrides.classified_model ?? null,
    classified_prompt_version: overrides.classified_prompt_version ?? null,
    classified_guess: overrides.classified_guess ?? null,
    classify_attempts: overrides.classify_attempts ?? 0,
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
    description: overrides.description ?? null,
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
    // The epic-spec columns the Worker writes; a seeded epic carries them only when the test
    // is exercising an already-refined epic.
    spec_path: overrides.spec_path ?? null,
    spec_sha: overrides.spec_sha ?? null,
    spec_markdown: overrides.spec_markdown ?? null,
    refinement_pr_url: overrides.refinement_pr_url ?? null,
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
    blocked_from: overrides.blocked_from ?? null,
    requires_refinement: overrides.requires_refinement ?? true,
    created_at: overrides.created_at ?? nextCreatedAt(),
    updated_at: overrides.updated_at ?? nextCreatedAt(),
    priority: overrides.priority ?? 1,
  };
}

// ── Habit seed builders. ──

/**
 * The browser's own today — the day the grid rings and the sidebar badge counts. Local, not
 * UTC: a habit's day is the owner's calendar day, so a UTC date would name yesterday's square
 * for anyone west of Greenwich.
 */
export function localToday(): string {
  return formatLocal(new Date());
}

/** A local calendar date `count` days behind today — the same arithmetic the grid walks. */
export function localDaysAgo(count: number): string {
  const then = new Date();
  then.setDate(then.getDate() - count);
  return formatLocal(then);
}

function formatLocal(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** A habit definition. Defaults to the reference habit's cadence: every day, one miss a week. */
export function makeHabit(name: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name,
    notes: overrides.notes ?? null,
    criteria: overrides.criteria ?? [{ key: 'light', label: 'Outside for light', kind: 'boolean' }],
    active_days: overrides.active_days ?? [1, 2, 3, 4, 5, 6, 7],
    allowance: overrides.allowance ?? 1,
    started_on: overrides.started_on ?? '2026-01-01',
    archived_at: overrides.archived_at ?? null,
    sort_order: overrides.sort_order ?? null,
    created_at: overrides.created_at ?? nextCreatedAt(),
  };
}

/** One logged day, carrying both the raw results and the status frozen from them. */
export function makeHabitEntry(
  habitId: string,
  entryDate: string,
  overrides: Partial<HabitEntry> = {},
): HabitEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    habit_id: habitId,
    entry_date: entryDate,
    status: overrides.status ?? 'met',
    results: overrides.results ?? null,
    note: overrides.note ?? null,
    created_at: overrides.created_at ?? nextCreatedAt(),
    updated_at: overrides.updated_at ?? nextCreatedAt(),
  };
}
