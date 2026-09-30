import { looksLikeHtmlDocument } from '@/lib/html-document';

/**
 * What to call a spec document in a list of things to open: an HTML spec's `<title>`, a markdown
 * spec's first `#` line, else the file's name, else `fallback`. Reading the title off the
 * snapshot (rather than the path) says what the document *is*: `ALF-100.html` says nothing.
 *
 * The HTML is parsed with `DOMParser` into an inert document — nothing in it runs or loads —
 * which also decodes entities and collapses whitespace in the title.
 */
export function specTitle(spec: string, specPath: string | null, fallback: string): string {
  const fromDocument = looksLikeHtmlDocument(spec) ? htmlTitle(spec) : markdownTitle(spec);
  if (fromDocument !== '') return fromDocument;
  const fileName = specPath?.split('/').pop();
  return fileName === undefined || fileName === '' ? fallback : fileName;
}

function htmlTitle(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').title.trim();
}

function markdownTitle(markdown: string): string {
  // Fenced code first: a `# comment` line in a shell block is not a heading.
  const prose = markdown.replaceAll(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '');
  // A single `#` then the text — `##` and deeper are sections, not the document's title.
  const match = /^#[ \t]+(.+)$/m.exec(prose);
  return match?.[1]?.trim() ?? '';
}
