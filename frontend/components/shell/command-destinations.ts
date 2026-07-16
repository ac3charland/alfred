import type { Folder, Project } from '@/lib/types';

/**
 * ⌘K command palette — the pure filter/rank/group layer, kept free of React and the DOM so the
 * matching rules are exhaustively unit-testable on their own (the direct sibling of
 * `search-results.ts`). The palette component just renders whatever `buildDestinations` returns.
 *
 * Unlike ⌘P content search, ⌘K lists navigation *destinations*: the two modules, the
 * cross-cutting views, every folder, and every project. An empty query lists them all, so the
 * palette doubles as a browsable "where can I go?" menu.
 */

/** The three destination groups, in display + keyboard-traversal order. */
export type DestinationGroup = 'go' | 'folders' | 'projects';

/**
 * A stable icon token per destination, resolved to a concrete lucide icon by the component —
 * kept as a string here so this module stays DOM-free.
 */
export type DestinationIcon =
  | 'tasks'
  | 'inbox'
  | 'priority'
  | 'completed'
  | 'code'
  | 'backlog'
  | 'needs-human-action'
  | 'folder'
  | 'project';

/** A single navigation destination, normalized across the static + dynamic sources. */
export interface Destination {
  /** Stable id, unique across all groups — the `aria-activedescendant` target. */
  id: string;
  group: DestinationGroup;
  label: string;
  /** The client-side destination view (ViewLink / pushState convention). */
  href: string;
  icon: DestinationIcon;
  /** Projects carry their 3-char key: shown as a pill and matched as a secondary field. */
  key?: string;
}

/** The grouped output — each group's matches in ranked order. */
export interface GroupedDestinations {
  go: Destination[];
  folders: Destination[];
  projects: Destination[];
}

/**
 * The static Go-to destinations, known at build time. Order here is the group's natural order —
 * preserved for empty queries and used to break ranking ties.
 */
const STATIC_DESTINATIONS: readonly Destination[] = [
  { id: 'go-tasks', group: 'go', label: 'Tasks', href: '/', icon: 'tasks' },
  { id: 'go-inbox', group: 'go', label: 'Inbox', href: '/?view=inbox', icon: 'inbox' },
  { id: 'go-priority', group: 'go', label: 'Priority', href: '/priority', icon: 'priority' },
  { id: 'go-completed', group: 'go', label: 'Completed', href: '/completed', icon: 'completed' },
  { id: 'go-code', group: 'go', label: 'Code', href: '/code', icon: 'code' },
  { id: 'go-backlog', group: 'go', label: 'Backlog', href: '/code/backlog', icon: 'backlog' },
  {
    id: 'go-needs-human-action',
    group: 'go',
    label: 'Needs human action',
    href: '/code/needs-human-action',
    icon: 'needs-human-action',
  },
];

/** Trim + lowercase so matching is whitespace- and case-insensitive. */
function normalize(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Rank a single field against the normalized query: prefix (0) beats substring (1); `null` means
 * no match. Mirrors the `search-results.ts` ladder, one field at a time.
 */
function rankField(query: string, text: string): number | null {
  const value = text.toLowerCase();
  if (value.startsWith(query)) return 0;
  if (value.includes(query)) return 1;
  return null;
}

/**
 * A destination's best rank against the query: the lower of its label rank and (for projects) its
 * key rank, so `ALF` surfaces the project whose key is `ALF` even when the name doesn't match.
 * `null` drops it from the results.
 */
function rankDestination(query: string, destination: Destination): number | null {
  const labelRank = rankField(query, destination.label);
  const keyRank = destination.key === undefined ? null : rankField(query, destination.key);
  if (labelRank === null && keyRank === null) return null;
  return Math.min(labelRank ?? Number.POSITIVE_INFINITY, keyRank ?? Number.POSITIVE_INFINITY);
}

/**
 * Filter + rank one group's destinations. An empty query keeps the whole group in natural order;
 * otherwise non-matches drop and matches sort by rank (prefix before substring), ties broken by
 * natural order via a stable sort.
 */
function filterGroup(query: string, destinations: readonly Destination[]): Destination[] {
  if (query === '') return [...destinations];
  const scored = destinations
    .map((destination) => ({ destination, rank: rankDestination(query, destination) }))
    .filter((entry): entry is { destination: Destination; rank: number } => entry.rank !== null);
  // Stable sort: prefix (0) before substring (1), ties keep the group's natural order.
  scored.sort((a, b) => a.rank - b.rank);
  return scored.map((entry) => entry.destination);
}

/** A folder becomes a Folders-group destination routing to its view. */
function folderDestination(folder: Folder): Destination {
  return {
    id: `folder-${folder.id}`,
    group: 'folders',
    label: folder.name,
    href: `/folders/${folder.id}`,
    icon: 'folder',
  };
}

/** A project becomes a Projects-group destination routing to its board, carrying its key pill. */
function projectDestination(project: Project): Destination {
  return {
    id: `project-${project.id}`,
    group: 'projects',
    label: project.name,
    href: `/code/${project.id}`,
    icon: 'project',
    key: project.key,
  };
}

/**
 * Filter, rank, and group the destinations against `query`. Pure: the store snapshots in →
 * grouped, ranked destinations out. An empty (or whitespace-only) query returns every
 * destination grouped in natural order — the palette's browse mode.
 *
 * Folders/projects keep the store's existing order (their natural tie-break); projects match on
 * their `key` as well as their name.
 */
export function buildDestinations(
  query: string,
  folders: readonly Folder[],
  projects: readonly Project[],
): GroupedDestinations {
  const q = normalize(query);
  return {
    go: filterGroup(q, STATIC_DESTINATIONS),
    folders: filterGroup(
      q,
      folders.map((folder) => folderDestination(folder)),
    ),
    projects: filterGroup(
      q,
      projects.map((project) => projectDestination(project)),
    ),
  };
}

/** The three groups concatenated into one ordered list for ↑/↓ keyboard navigation. */
export function flattenDestinations(grouped: GroupedDestinations): Destination[] {
  return [...grouped.go, ...grouped.folders, ...grouped.projects];
}

/** A stable DOM id for a destination's `<li role="option">` (for `aria-activedescendant`). */
export function destinationDomId(destination: Destination): string {
  return `command-destination-${destination.id}`;
}
