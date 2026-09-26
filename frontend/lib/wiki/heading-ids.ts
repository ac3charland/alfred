/**
 * The page's heading ids, computed the way the wiki computes them, so every `#anchor` its lint
 * checked lands on a real heading here.
 *
 * The wiki reads the page's RAW source, not rendered text: ATX headings only (a Setext heading
 * gets no id, because the wiki doesn't count it), after masking code the same way the Worker does
 * — fenced ``` / ~~~ blocks and inline code spans — so a `## x` inside code is never a heading.
 * A heading's own inline code is masked out of its text before slugging, exactly as the wiki's
 * lint does, so `## The \`yaml\` parser` anchors as `the--parser` (not GitHub's rendered
 * `the-yaml-parser`). The rest is slugged the GitHub way, repeats numbered `-1`, `-2` ….
 */

/** One heading the wiki counts: the 1-based source line it sits on, and its id. */
export interface HeadingAnchor {
  line: number;
  id: string;
}

/** A fence line: up to three spaces, then three or more backticks or tildes (as the Worker). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * An inline code span, as the Worker masks it: a backtick run, anything, the same-length run —
 * never across a blank line.
 */
const INLINE_CODE = /(`+)(?:(?!\n[\t ]*\n)[\s\S])*?\1/g;

/**
 * An ATX heading line: up to three spaces, one to six `#`, then whitespace and text, with an
 * optional closing run of `#`. Capture 1 is the text.
 */
const ATX = /^ {0,3}#{1,6}[\t ]+(.*?)(?:[\t ]+#+)?[\t ]*$/;

/** What GitHub's slugger drops: everything but letters, marks, numbers, `_`, `-` and space. */
const SLUG_DROP = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

/**
 * The page with its code blanked. Unlike the Worker's copy, which only needs link positions,
 * this keeps every newline — a span's own characters become spaces, a fenced line becomes empty —
 * so line N of the result is line N of the page.
 */
function maskCode(text: string): string {
  let fence: string | undefined;
  const masked = text.split('\n').map((line) => {
    const open = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (open === undefined) return line;
      fence = open;
      return '';
    }
    if (open !== undefined && open.startsWith(fence.charAt(0)) && open.length >= fence.length) {
      fence = undefined;
    }
    return '';
  });
  return masked.join('\n').replaceAll(INLINE_CODE, (span) => span.replaceAll(/[^\n]/g, ' '));
}

/** GitHub's slug for one heading's text (without the repeat suffix). */
export function slugHeading(text: string): string {
  return text.toLowerCase().replaceAll(SLUG_DROP, '').replaceAll(' ', '-');
}

/** Every heading the wiki counts, in page order, each with its line and de-duplicated id. */
export function headingAnchorEntries(body: string): HeadingAnchor[] {
  const source = body.replaceAll('\r\n', '\n');
  const rawLines = source.split('\n');
  const maskedLines = maskCode(source).split('\n');
  const seen = new Map<string, number>();
  const anchors: HeadingAnchor[] = [];

  for (const [index, masked] of maskedLines.entries()) {
    if (!ATX.test(masked)) continue;
    // The text comes from the raw line with its code spans removed outright — the wiki's rule,
    // which leaves the spaces either side, so `## The \`yaml\` parser` → `the--parser`.
    const text = (ATX.exec(rawLines[index] ?? '')?.[1] ?? '').replaceAll(INLINE_CODE, '').trim();
    if (text === '') continue;

    const original = slugHeading(text);
    let id = original;
    // GitHub's slugger: bump the original's counter until the candidate is unused.
    while (seen.has(id)) {
      const next = (seen.get(original) ?? 0) + 1;
      seen.set(original, next);
      id = `${original}-${String(next)}`;
    }
    seen.set(id, 0);
    anchors.push({ line: index + 1, id });
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
      if (id !== undefined && source.charAt(offset) === '#') {
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  return () => visit;
}
