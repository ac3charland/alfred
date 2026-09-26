import 'server-only';

/**
 * The stored post text as HTML paragraphs — the body a send carries for a post ingested before
 * the Worker kept the email's HTML. The Worker's `htmlToText` writes one line per block, so a line
 * is a paragraph; escaping comes first, because the text is prose and a post that quotes markup
 * must arrive in Instapaper as the words it wrote, not as tags.
 */

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

export function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}
