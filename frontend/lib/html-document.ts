/**
 * Does this string look like a whole, self-contained HTML document (rather than a fragment
 * or markdown)? Sniffs the head for a doctype or an opening `<html>`, tolerating leading
 * whitespace and any casing.
 *
 * Shared by the two places a stored document arrives from outside the app: the code module's
 * spec snapshot (which may be legacy markdown instead, and picks its renderer from this) and
 * the weekly-plan upload endpoint (which rejects a body that isn't a document).
 */
export function looksLikeHtmlDocument(candidate: string): boolean {
  const head = candidate.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}
