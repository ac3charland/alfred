import { storyBoardHref } from '@/lib/code/board-links';
import { FACTORY_STATE_LABELS } from '@/lib/stores/code-store';
import { residentFolderId } from '@/lib/tasks/residency';
import { resolveRoot, taskDestination } from '@/lib/tasks/task-location';
import type { CodeStory, Folder, Item, WikiPageIndexRow } from '@/lib/types';
import { rankWikiPage } from '@/lib/wiki/match';
import { wikiPageHref } from '@/lib/wiki/sections';

/**
 * Global search — the pure filter/rank/cap layer, kept free of React and the DOM so the
 * matching rules are exhaustively unit-testable on their own. The combobox just renders
 * whatever `buildResults` returns; everything below is a plain function over the seeded store
 * snapshots. A task's destination view comes from the shared `taskDestination` helper.
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
      /** Completed/terminal items are hidden by default; shown de-emphasized when revealed. */
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
    }
  | {
      kind: 'wiki';
      /** The page's path — also the ⌘P row's DOM id key. */
      id: string;
      title: string;
      /** The page's summary. */
      subtitle: string;
      href: string;
      /** A wiki page is never "completed"; kept so every result shares one row shape. */
      completed: boolean;
      page: WikiPageIndexRow;
    };

export interface SearchResults {
  tasks: SearchResult[];
  stories: SearchResult[];
  wiki: SearchResult[];
  /** How many further matches were dropped by the per-group cap, per group. */
  truncated: { tasks: number; stories: number; wiki: number };
}

const EMPTY: SearchResults = {
  tasks: [],
  stories: [],
  wiki: [],
  truncated: { tasks: 0, stories: 0, wiki: 0 },
};

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
 * Sort wiki matches by rank ascending, then `updated` descending, with a never-updated page
 * (`null`) sorting last within its rank. Plain string comparison, never `localeCompare` — an
 * ISO `YYYY-MM-DD` date orders correctly as a string and stays independent of the machine's
 * locale (the `sections.ts` convention).
 */
function byWikiRankThenUpdated(a: { rank: number; updated: string | null }, b: typeof a): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.updated === b.updated) return 0;
  if (a.updated === null) return 1;
  if (b.updated === null) return -1;
  if (a.updated > b.updated) return -1;
  return 1;
}

/**
 * The location label shown under a task result (folder name / Inbox / Completed). Reads
 * residency, not `folder_id`: an item awaiting triage says "Inbox" even when it already carries
 * a folder, matching the view the result actually jumps to.
 */
function taskSubtitle(item: Item, byId: Map<string, Item>, folders: readonly Folder[]): string {
  const root = resolveRoot(item, byId);
  if (root.status === 'completed') return 'Completed';
  const folderId = residentFolderId(root);
  if (folderId !== null) {
    return folders.find((folder) => folder.id === folderId)?.name ?? 'Folder';
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
 *
 * Completed tasks and terminal (done/abandoned) stories are excluded unless `includeCompleted`
 * is set — a search is usually chasing something still live, and a done item that shares the
 * query term would otherwise crowd out the active matches the search is actually for.
 *
 * Wiki pages match on `rankWikiPage` — the same title/summary/tag matcher the Wiki module's
 * instant search uses, never the body — ranked, then broken by `updated` descending.
 * `includeCompleted` doesn't apply to wiki pages; there is no such state.
 */
export function buildResults(
  query: string,
  tasks: readonly Item[],
  stories: readonly CodeStory[],
  folders: readonly Folder[] = [],
  includeCompleted = false,
  pages: readonly WikiPageIndexRow[] = [],
): SearchResults {
  const q = normalize(query);
  if (q === '') return EMPTY;

  const byId = new Map(tasks.map((task) => [task.id, task] as const));

  const scoredTasks: { result: SearchResult; rank: number; createdAt: string }[] = [];
  for (const item of tasks) {
    const completed = item.status === 'completed';
    if (completed && !includeCompleted) continue;
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
        completed,
        item,
      },
    });
  }

  const scoredStories: { result: SearchResult; rank: number; createdAt: string }[] = [];
  for (const story of stories) {
    const completed = isStoryTerminal(story);
    if (completed && !includeCompleted) continue;
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
        href: storyBoardHref(story.project_id ?? '', story.ref ?? ''),
        completed,
        story,
      },
    });
  }

  const scoredPages: { result: SearchResult; rank: number; updated: string | null }[] = [];
  for (const page of pages) {
    const rank = rankWikiPage(query, page);
    if (rank === null) continue;
    scoredPages.push({
      rank,
      updated: page.updated,
      result: {
        kind: 'wiki',
        id: page.path,
        title: page.title,
        subtitle: page.summary,
        href: wikiPageHref(page.path),
        completed: false,
        page,
      },
    });
  }

  scoredTasks.sort(byRankThenRecency);
  scoredStories.sort(byRankThenRecency);
  scoredPages.sort(byWikiRankThenUpdated);

  return {
    tasks: scoredTasks.slice(0, RESULTS_PER_GROUP).map((entry) => entry.result),
    stories: scoredStories.slice(0, RESULTS_PER_GROUP).map((entry) => entry.result),
    wiki: scoredPages.slice(0, RESULTS_PER_GROUP).map((entry) => entry.result),
    truncated: {
      tasks: Math.max(0, scoredTasks.length - RESULTS_PER_GROUP),
      stories: Math.max(0, scoredStories.length - RESULTS_PER_GROUP),
      wiki: Math.max(0, scoredPages.length - RESULTS_PER_GROUP),
    },
  };
}

/** The three groups concatenated into one ordered list for keyboard navigation. */
export function flattenResults(results: SearchResults): SearchResult[] {
  return [...results.tasks, ...results.stories, ...results.wiki];
}

/**
 * A stable DOM id for a result's `<li role="option">` (for `aria-activedescendant`). A wiki
 * result's id is its repo path, which — unlike a task/story UUID — can carry a character (a
 * literal space, say) that isn't valid in an HTML id, so it's percent-encoded first.
 */
export function optionDomId(result: SearchResult): string {
  const key = result.kind === 'wiki' ? encodeURIComponent(result.id) : result.id;
  return `search-option-${result.kind}-${key}`;
}
