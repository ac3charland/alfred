/**
 * The page's heading ids, computed exactly the way the wiki computes them (its `headingAnchors`,
 * `scripts/lib/wiki.ts`), so every `#anchor` its lint checked lands on a real heading here.
 *
 * The wiki reads the page's RAW source line by line, not rendered text: ATX headings only (a
 * Setext heading gets no id, because the wiki doesn't count it), after masking code the wiki's
 * way — a fenced ``` / ~~~ block, which any later fence line of the same character closes
 * whatever its length, and on every other line each single-backtick span, removed outright and
 * never reaching past its line. So `## The \`yaml\` parser` anchors as `the--parser` (not GitHub's
 * rendered `the-yaml-parser`), and a heading that is only code can anchor as ''.
 *
 * The slug keeps letters, numbers, `_`, `-` and spaces (Unicode-aware) and drops the rest —
 * combining marks and connector punctuation included — then spaces become `-`. A repeat takes
 * `-1`, `-2` … from one counter per slug, with no check against a heading already written that
 * way: `## Notes`, `## Notes-1`, `## Notes` anchor as `notes`, `notes-1`, `notes-1`.
 */

/** One heading the wiki counts: the 1-based source line it sits on, and its id. */
export interface HeadingAnchor {
  line: number;
  id: string;
}

/** A fence line: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** An inline code span, as the wiki masks it: one backtick, anything on the line, one backtick. */
const INLINE_CODE = /`[^`\n]+`/g;

/**
 * An ATX heading line, the wiki's pattern: up to three spaces, one to six `#`, whitespace, then
 * the text, with trailing whitespace and any closing run of `#` dropped. Capture 1 is the text.
 */
const ATX = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/** What the wiki's slug drops: everything but letters, numbers, `_`, `-` and space. */
const SLUG_DROP = /[^\p{L}\p{N} _-]/gu;

/**
 * The page with its code blanked, line for line (so line N of the result is line N of the page):
 * a fenced line, fences included, becomes empty, and every other line loses its inline code.
 */
function maskCode(text: string): string[] {
  let fence: string | undefined;
  return text.split('\n').map((line) => {
    const open = FENCE.exec(line)?.[1]?.charAt(0);
    if (open !== undefined && (fence === undefined || fence === open)) {
      fence = fence === undefined ? open : undefined;
      return '';
    }
    return fence === undefined ? line.replaceAll(INLINE_CODE, '') : '';
  });
}

/** The wiki's slug for one heading's text (without the repeat suffix). */
export function slugHeading(text: string): string {
  return text.toLowerCase().replaceAll(SLUG_DROP, '').replaceAll(' ', '-');
}

/** Every heading the wiki counts, in page order, each with its line and de-duplicated id. */
export function headingAnchorEntries(body: string): HeadingAnchor[] {
  const counts = new Map<string, number>();
  const anchors: HeadingAnchor[] = [];

  for (const [index, line] of maskCode(body.replaceAll('\r\n', '\n')).entries()) {
    const text = ATX.exec(line)?.[1];
    if (text === undefined) continue;
    const base = slugHeading(text.trim());
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    anchors.push({ line: index + 1, id: seen === 0 ? base : `${base}-${String(seen)}` });
  }
  return anchors;
}

/** The page's heading ids, in order. */
export function headingAnchors(body: string): string[] {
  return headingAnchorEntries(body).map((anchor) => anchor.id);
}

/** The slice of an mdast node the plugin reads and writes — structural, so it needs no mdast import. */
interface MarkdownNode {
  type: string;
  position?: { start: { line: number; column: number; offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}

/**
 * A remark plugin that hands `body`'s heading ids to its heading nodes. A node receives the id of
 * the wiki heading on its own source line, and only when its source starts with `#` — so a Setext
 * heading, or one nested in a quote or list (which the wiki's line reading never counts), gets
 * none, and the ids of the rest stay exactly the wiki's.
 */
export function remarkHeadingIds(body: string): () => (tree: MarkdownNode) => void {
  const source = body.replaceAll('\r\n', '\n');
  const idByLine = new Map(headingAnchorEntries(source).map((anchor) => [anchor.line, anchor.id]));

  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start;
    if (node.type === 'heading' && start !== undefined) {
      const id = idByLine.get(start.line);
      const offset = start.offset ?? -1;
      // An empty id is still counted (it numbers the next repeat) but never drawn: `id=""` is no
      // anchor at all.
      if (id !== undefined && id !== '' && source.charAt(offset) === '#') {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  return () => visit;
}
