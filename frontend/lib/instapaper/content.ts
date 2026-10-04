import 'server-only';

/**
 * The fallback body for a post that has no stored email HTML — every post ingested before the
 * Reader began keeping it, and any whose markup was too large to store.
 *
 * Instapaper's `content` parameter is parsed as a document, so the stored text has to arrive as
 * one. `htmlToText` left it one line per block, which is the whole structure there is to
 * recover: each non-empty line becomes a paragraph. Images, headings, lists and links are gone
 * for good — they were lost on the way in, not here — which is exactly why the HTML rung exists
 * and this one is the fallback.
 */

/** The five characters that would otherwise be read as markup. */
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/**
 * The stored text as a run of `<p>` elements, HTML-escaped first — the text came out of mail
 * nobody in this system wrote, and it is about to be sent somewhere that parses it as a
 * document. Returns an empty string for text that is blank or only whitespace, so a caller can
 * treat "no body" as one case however the column got that way.
 */
export function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}
