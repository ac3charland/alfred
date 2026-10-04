import 'server-only';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * A stored plain-text body as HTML Instapaper can parse: escaped, one `<p>` per non-empty line
 * (the stored text keeps one line per block). The body a send falls back to for a post ingested
 * before the email HTML was kept. Empty when the text has nothing in it.
 */
export function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${line.replaceAll(/[&<>"']/g, (character) => ESCAPES[character] ?? '')}</p>`)
    .join('\n');
}
