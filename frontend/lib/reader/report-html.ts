import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import 'server-only';
import { unified } from 'unified';

/**
 * A research report's markdown as the HTML the Reader stores for it, rendered once at delivery.
 * The stored HTML is what Send hands to Instapaper as the post's body, so the owner reads the
 * report there with its headings, tables and links intact.
 *
 * The pipeline is unified's: parse, GFM (tables, autolinks), then mdast → hast → a string. It
 * never turns on `allowDangerousHtml`, so `remark-rehype` drops every raw HTML node in the
 * markdown — a `<script>`, an `<img onerror>`, an `<iframe>`, a comment. That is the point of the
 * choice: the research session reads arbitrary web pages, and markup an injected page talks it
 * into writing must not ride into Instapaper as live HTML. Markup written inside a code span or
 * fence is text, not a raw node, and comes out escaped. A link or image whose target is anything
 * but the web, mail or a fragment (`javascript:`, `data:`) keeps its text and loses its target.
 *
 * Server-only, and delivery is its only caller: rendering once means a report is never re-rendered
 * per read, and keeps this dependency chain out of the browser bundle.
 */

/**
 * The only link and image targets a report may carry: the web, mail, and a jump within the report
 * itself. Dropping raw HTML doesn't touch a markdown link's destination, so `[x](javascript:…)`
 * would otherwise reach the stored HTML as a live `href`.
 */
const SAFE_SCHEME = /^(?:https?|mailto):/i;

/** Whether a destination is scheme-less (a fragment or a relative path) or a safe scheme. */
function isSafeTarget(value: string): boolean {
  const target = value.trim();
  return !/^[a-z][\w+.-]*:/i.test(target) || SAFE_SCHEME.test(target);
}

/** The slice of a hast node this pass reads — structural, so it needs no `hast` types import. */
interface HastNode {
  type: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * A rehype step that removes every `href` / `src` whose target is not {@link isSafeTarget}. The
 * element stays, so a link's text and an image's alt still read; only the target goes.
 */
function rehypeDropUnsafeTargets() {
  const visit = (node: HastNode): void => {
    if (node.type === 'element' && node.properties !== undefined) {
      for (const attribute of ['href', 'src']) {
        const value = node.properties[attribute];
        if (typeof value === 'string' && !isSafeTarget(value)) {
          node.properties[attribute] = undefined;
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  return visit;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeDropUnsafeTargets)
  .use(rehypeStringify);

export function renderReportHtml(markdown: string): string {
  return String(processor.processSync(markdown));
}
