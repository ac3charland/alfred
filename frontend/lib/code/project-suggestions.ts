import { rankField } from '@/lib/rank-field';
import type { Project } from '@/lib/types';

/**
 * The capture box's project-suggestion layer — the pure half of "type a leading `:` to pick a
 * project". It derives the live trigger from the box's raw value, filters and ranks the projects
 * against it, and produces the text a selection writes back.
 *
 * Deliberately free of React and the DOM: the classification itself still happens in
 * `project-prefix.ts` at submit time, so this module only ever makes that prefix easy to *type*.
 */

/** The live trigger, derived from the capture box's raw value. */
export interface SuggestTrigger {
  /** Text between the leading ':' and the first whitespace — '' right after ':'. */
  query: string;
  /** Everything after the query (trimmed) — preserved through a selection. */
  remainder: string;
}

/**
 * The trigger for `value`, or `null` when the box isn't in the `:query` state.
 *
 * The first non-whitespace character must be ':' — a colon anywhere else is an ordinary capture
 * (`Note: buy milk`) that the submit-time prefix parse handles on its own. Everything from the
 * colon to the first whitespace is the query; the rest is the remainder, which survives selection
 * so `:al add dark mode` can become `ALF: add dark mode`.
 */
export function parseSuggestTrigger(value: string): SuggestTrigger | null {
  const text = value.trimStart();
  if (!text.startsWith(':')) return null;

  const tail = text.slice(1);
  const whitespaceIndex = tail.search(/\s/);
  if (whitespaceIndex === -1) return { query: tail, remainder: '' };
  return { query: tail.slice(0, whitespaceIndex), remainder: tail.slice(whitespaceIndex).trim() };
}

/**
 * Projects matching `query`, best first: prefix beats substring, key and name are both matched
 * case-insensitively, and the better of the two ranks wins. Ties keep the given order (the store's
 * nav order, which is also the order the colour palette is assigned in). An empty query returns
 * every project, unfiltered.
 */
export function rankProjectSuggestions(query: string, projects: readonly Project[]): Project[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return [...projects];

  const scored = projects
    .map((project) => {
      const keyRank = rankField(normalized, project.key);
      const nameRank = rankField(normalized, project.name);
      const rank =
        keyRank === null && nameRank === null
          ? null
          : Math.min(keyRank ?? Number.POSITIVE_INFINITY, nameRank ?? Number.POSITIVE_INFINITY);
      return { project, rank };
    })
    .filter((entry): entry is { project: Project; rank: number } => entry.rank !== null);

  // Stable sort: prefix (0) before substring (1), ties keep the given order.
  scored.sort((a, b) => a.rank - b.rank);
  return scored.map((entry) => entry.project);
}

/**
 * The box's next value once `project` is chosen: `ALF: ` or `ALF: add dark mode`. Always the key,
 * even when the user typed the name — it's the canonical, unique form the submit-time parse
 * prefers, and the trailing space leaves the caret ready for the title.
 */
export function applyProjectSuggestion(trigger: SuggestTrigger, project: Project): string {
  return `${project.key}: ${trigger.remainder}`;
}

/** Stable DOM id for a row's `<li role="option">` (the `aria-activedescendant` target). */
export function projectSuggestionDomId(project: Project): string {
  return `project-suggestion-${project.id}`;
}
