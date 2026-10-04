import 'server-only';

/**
 * Escape the five characters that matter when text lands inside HTML. The ampersand goes first
 * so the entities written for the other four aren't themselves escaped a second time.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Stored post text as the HTML body Instapaper's `content` parameter wants.
 *
 * The Reader keeps a post's plain text one block per line, so each non-empty line becomes one
 * paragraph; blank lines separate nothing that isn't already separated and are dropped. The
 * text came out of mail nobody here wrote, so every character that could open a tag or close an
 * attribute is escaped — Instapaper renders what it is given.
 */
export function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}
