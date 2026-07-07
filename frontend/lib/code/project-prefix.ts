import type { Project } from '@/lib/types';

/** A matched project prefix and the cleaned title to capture the item under. */
export interface ProjectPrefixMatch {
  /** The matched project. */
  project: Project;
  /** The remainder with the prefix stripped and its first letter capitalized. */
  title: string;
}

/** Uppercase only the first character; the rest is left as typed. A non-letter is a no-op. */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * If `text` starts with `<project name|key>:` (case-insensitive, split at the FIRST colon),
 * return the matched project and the cleaned title. Otherwise return null.
 *
 * - The text before the first colon (trimmed) is the candidate prefix; the text after
 *   (trimmed) is the remainder. Later colons stay in the remainder.
 * - `key` is unique, so a key match wins first; otherwise fall back to a case-insensitive
 *   `name` match, but only when exactly one project bears that name — an ambiguous
 *   (duplicate) name is treated as no match rather than guessing.
 * - An empty remainder, or no colon, → null (nothing worth classifying).
 * - The title uppercases only the first character of the remainder; the rest is unchanged.
 */
export function parseProjectPrefix(
  text: string,
  projects: readonly Project[],
): ProjectPrefixMatch | null {
  const colonIndex = text.indexOf(':');
  if (colonIndex === -1) return null;

  const candidate = text.slice(0, colonIndex).trim();
  const remainder = text.slice(colonIndex + 1).trim();
  if (candidate === '' || remainder === '') return null;

  const lowered = candidate.toLowerCase();

  // A key match is unambiguous (keys are unique) and wins first.
  let project = projects.find((p) => p.key.toLowerCase() === lowered);
  if (project === undefined) {
    // Fall back to a case-insensitive name match, but only when exactly one project bears
    // that name — `name` is not unique, so a duplicate-name prefix is ambiguous → no match.
    const byName = projects.filter((p) => p.name.toLowerCase() === lowered);
    if (byName.length === 1) project = byName[0];
  }
  if (project === undefined) return null;

  return { project, title: capitalizeFirst(remainder) };
}
