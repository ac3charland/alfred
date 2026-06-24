import { FACTORY_STATE_LABELS } from '@/lib/stores/code-store';
import type { CodeStory, Folder, Item } from '@/lib/types';

/**
 * Global search — the pure filter/rank/cap layer, kept free of React and the DOM so the
 * matching rules are exhaustively unit-testable on their own. The combobox just renders
 * whatever `buildResults` returns; everything below (`buildResults`, `taskDestination`) is a
 * plain function over the seeded store snapshots.
 */

/** Each group shows at most this many matches; the rest are surfaced as a "+N more" line. */
export const RESULTS_PER_GROUP = 8;

/** A single match, normalized across the two sources so rendering and keyboard nav stay uniform. */
export type SearchResult =
  | {
      kind: 'task';
      /** The item id — also the focus-event target when this result is selected. */
      id: string;
      title: string;
      /** Where the row lives (folder name / Inbox / Completed). */
      subtitle: string;
      /** The client-side destination view (ViewLink convention). */
      href: string;
      /** Completed/terminal items are shown but visually de-emphasized. */
      completed: boolean;
      item: Item;
    }
  | {
      kind: 'story';
      id: string;
      title: string;
      ref: string;
      subtitle: string;
      href: string;
      completed: boolean;
      story: CodeStory;
    };

export interface SearchResults {
  tasks: SearchResult[];
  stories: SearchResult[];
  /** How many further matches were dropped by the per-group cap, per group. */
  truncated: { tasks: number; stories: number };
}

const EMPTY: SearchResults = { tasks: [], stories: [], truncated: { tasks: 0, stories: 0 } };

/** Trim + lowercase so matching is whitespace- and case-insensitive. */
function normalize(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Rank a title/notes pair against the normalized query: title-prefix (0) beats title-substring
 * (1) beats notes-only (2). `null` means no match on either field.
 */
function rankTitleNotes(query: string, title: string, notes: string): number | null {
  if (title.startsWith(query)) return 0;
  if (title.includes(query)) return 1;
  if (notes.includes(query)) return 2;
  return null;
}

/** Sort by rank ascending, breaking ties by recency (created_at descending). */
function byRankThenRecency(a: { rank: number; createdAt: string }, b: typeof a): number {
  return a.rank - b.rank || b.createdAt.localeCompare(a.createdAt);
}

/**
 * Resolve a task's top-level ancestor, so a subtask routes to the view that actually shows it.
 * Guards against a broken parent chain (a missing or cyclic `parent_id`) by bailing on a repeat.
 */
function resolveRoot(item: Item, byId: Map<string, Item>): Item {
  let root = item;
  const seen = new Set<string>();
  while (root.parent_id !== null && !seen.has(root.id)) {
    seen.add(root.id);
    const parent = byId.get(root.parent_id);
    if (parent === undefined) break;
    root = parent;
  }
  return root;
}

/**
 * The client-side destination for a task: its containing view, derived from the top-level
 * ancestor's own fields. Completed → the Completed view; in a folder → that folder; otherwise
 * the Inbox (revealed via `?view=inbox`). Exported for direct unit coverage.
 */
export function taskDestination(item: Item, tasks: readonly Item[]): string {
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const root = resolveRoot(item, byId);
  if (root.status === 'completed') return '/completed';
  if (root.folder_id !== null) return `/folders/${root.folder_id}`;
  return '/?view=inbox';
}

/** The location label shown under a task result (folder name / Inbox / Completed). */
function taskSubtitle(item: Item, byId: Map<string, Item>, folders: readonly Folder[]): string {
  const root = resolveRoot(item, byId);
  if (root.status === 'completed') return 'Completed';
  if (root.folder_id !== null) {
    return folders.find((folder) => folder.id === root.folder_id)?.name ?? 'Folder';
  }
  return 'Inbox';
}

/** The location label shown under a story result: its epic and current factory state. */
function storySubtitle(story: CodeStory): string {
  const parts: string[] = [];
  if (story.epic_name !== null) parts.push(story.epic_name);
  if (story.factory_state !== null) parts.push(FACTORY_STATE_LABELS[story.factory_state]);
  return parts.join(' · ');
}

/** A story counts as terminal (de-emphasized) once it's done or abandoned. */
function isStoryTerminal(story: CodeStory): boolean {
  return story.factory_state === 'done' || story.factory_state === 'abandoned';
}

/**
 * Filter, rank, and cap the seeded stores against `query`. Pure: store snapshots in → ranked,
 * capped results out. An empty (or whitespace-only) query yields nothing.
 *
 * Tasks match on title + notes; stories also match on `ref` (so `ALF-31` finds that story
 * directly, and an exact ref match sorts to the very top of the Stories group).
 */
export function buildResults(
  query: string,
  tasks: readonly Item[],
  stories: readonly CodeStory[],
  folders: readonly Folder[] = [],
): SearchResults {
  const q = normalize(query);
  if (q === '') return EMPTY;

  const byId = new Map(tasks.map((task) => [task.id, task] as const));

  const scoredTasks: { result: SearchResult; rank: number; createdAt: string }[] = [];
  for (const item of tasks) {
    const rank = rankTitleNotes(q, item.title.toLowerCase(), (item.notes ?? '').toLowerCase());
    if (rank === null) continue;
    scoredTasks.push({
      rank,
      createdAt: item.created_at,
      result: {
        kind: 'task',
        id: item.id,
        title: item.title,
        subtitle: taskSubtitle(item, byId, folders),
        href: taskDestination(item, tasks),
        completed: item.status === 'completed',
        item,
      },
    });
  }

  const scoredStories: { result: SearchResult; rank: number; createdAt: string }[] = [];
  for (const story of stories) {
    const ref = (story.ref ?? '').toLowerCase();
    const titleNotesRank = rankTitleNotes(
      q,
      (story.title ?? '').toLowerCase(),
      (story.notes ?? '').toLowerCase(),
    );
    // An exact ref match floats above every other story; a ref substring matches like notes.
    const rank = ref === q ? -1 : (titleNotesRank ?? (ref.includes(q) ? 2 : null));
    if (rank === null) continue;
    scoredStories.push({
      rank,
      createdAt: story.item_created_at ?? story.code_created_at ?? '',
      result: {
        kind: 'story',
        id: story.item_id ?? story.ref ?? '',
        title: story.title ?? '(untitled)',
        ref: story.ref ?? '',
        subtitle: storySubtitle(story),
        href: `/code/${story.project_id ?? ''}?story=${encodeURIComponent(story.ref ?? '')}`,
        completed: isStoryTerminal(story),
        story,
      },
    });
  }

  scoredTasks.sort(byRankThenRecency);
  scoredStories.sort(byRankThenRecency);

  return {
    tasks: scoredTasks.slice(0, RESULTS_PER_GROUP).map((entry) => entry.result),
    stories: scoredStories.slice(0, RESULTS_PER_GROUP).map((entry) => entry.result),
    truncated: {
      tasks: Math.max(0, scoredTasks.length - RESULTS_PER_GROUP),
      stories: Math.max(0, scoredStories.length - RESULTS_PER_GROUP),
    },
  };
}

/** The two groups concatenated into one ordered list for keyboard navigation. */
export function flattenResults(results: SearchResults): SearchResult[] {
  return [...results.tasks, ...results.stories];
}

/** A stable DOM id for a result's `<li role="option">` (for `aria-activedescendant`). */
export function optionDomId(result: SearchResult): string {
  return `search-option-${result.kind}-${result.id}`;
}
