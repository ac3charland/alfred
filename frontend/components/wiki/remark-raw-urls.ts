/**
 * A remark plugin that keeps each link's and image's URL exactly as the page wrote it.
 *
 * By the time react-markdown hands an `a` or `img` override its `href` / `src`, mdast-util-to-hast
 * has percent-encoded it (`café.md` → `caf%C3%A9.md`, `100%-rule.md` → `100%25-rule.md`,
 * `<habit loop.md>` → `habit%20loop.md`). The wiki's rule — and the Worker's `links` — resolve the
 * raw string, so a renderer reading the encoded one would resolve a different path and draw a real
 * page as broken. This copies the raw `url` onto the element as `data-href`, which the overrides
 * resolve instead. A reference-style link or image takes its definition's URL.
 *
 * "As written" is the wiki's reading, not CommonMark's: a link written `[a](<habit-loop.md>)`
 * reaches the override with its angle brackets stripped, but the wiki's `extractLinks` — and so
 * the Worker's `links` — reads that target literally as `<habit-loop.md>`, which names no page.
 * So an angle-bracket destination keeps its brackets here, and never resolves as a page link.
 */

/** The attribute the raw URL rides on. */
export const RAW_URL_ATTRIBUTE = 'data-href';

/** The slice of an mdast node the plugin reads and writes — structural, so it needs no mdast import. */
interface MarkdownNode {
  type: string;
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  identifier?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function stamp(node: MarkdownNode, url: string): void {
  node.data = {
    ...node.data,
    hProperties: { ...node.data?.hProperties, [RAW_URL_ATTRIBUTE]: url },
  };
}

/** The slice of a vfile the plugin reads: the markdown source the tree was parsed from. */
interface SourceFile {
  value?: unknown;
}

/**
 * What follows a link's text when its destination is written in angle brackets: `](<`. Sticky, so
 * it matches at a set offset without copying the rest of the page for every link.
 */
const ANGLE_DESTINATION = /\]\([\t\n ]*</y;

/**
 * Whether `link`'s destination is written `<…>` in `source`: the text right after the link's
 * label (its last child's end, or just past the `[` of an empty label) opens one.
 */
function hasAngleDestination(link: MarkdownNode, source: string): boolean {
  const start = link.position?.start.offset;
  if (start === undefined) return false;
  const labelEnd = link.children?.at(-1)?.position?.end.offset ?? start + 1;
  ANGLE_DESTINATION.lastIndex = labelEnd;
  return ANGLE_DESTINATION.test(source);
}

/** Stamp every link and image in `tree` with its raw URL. */
function stampRawUrls(tree: MarkdownNode, source: string): void {
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier !== undefined && node.url !== undefined) {
      definitions.set(node.identifier, node.url);
    }
  });
  walk(tree, (node) => {
    if (node.type === 'link' && node.url !== undefined) {
      stamp(node, hasAngleDestination(node, source) ? `<${node.url}>` : node.url);
    } else if (node.type === 'image' && node.url !== undefined) {
      stamp(node, node.url);
    } else if (node.type === 'linkReference' || node.type === 'imageReference') {
      const url = node.identifier === undefined ? undefined : definitions.get(node.identifier);
      if (url !== undefined) stamp(node, url);
    }
  });
}

/** The transform: every link and image in `tree`, against the source `file` was parsed from. */
function transform(tree: MarkdownNode, file?: SourceFile): void {
  stampRawUrls(tree, typeof file?.value === 'string' ? file.value : '');
}

/** The plugin: react-markdown calls it once per render for the transform to run. */
export function remarkRawUrls(): (tree: MarkdownNode, file?: SourceFile) => void {
  return transform;
}
