/**
 * Rank one field against an already-normalized (trimmed, lowercased) query: a prefix match
 * scores 0, a substring match 1, and no match is `null` — a lower number sorts first.
 *
 * The single source of the "prefix beats substring" ladder shared by the ⌘K palette's
 * destinations and the capture box's project suggestions, so the two lists rank the same way.
 * A caller with several fields (a name and a key) takes the better of their ranks.
 */
export function rankField(query: string, text: string): number | null {
  const value = text.toLowerCase();
  if (value.startsWith(query)) return 0;
  if (value.includes(query)) return 1;
  return null;
}
