/**
 * A remark plugin that keeps each link's and image's URL exactly as the page wrote it.
 *
 * By the time react-markdown hands an `a` or `img` override its `href` / `src`, mdast-util-to-hast
 * has percent-encoded it (`café.md` → `caf%C3%A9.md`, `100%-rule.md` → `100%25-rule.md`,
 * `<habit loop.md>` → `habit%20loop.md`). The wiki's rule — and the Worker's `links` — resolve the
 * raw string, so a renderer reading the encoded one would resolve a different path and draw a real
 * page as broken. This copies the raw `url` onto the element as `data-href`, which the overrides
 * resolve instead. A reference-style link or image takes its definition's URL.
 */

/** The attribute the raw URL rides on. */
export const RAW_URL_ATTRIBUTE = 'data-href';

/** The slice of an mdast node the plugin reads and writes — structural, so it needs no mdast import. */
interface MarkdownNode {
  type: string;
  url?: string;
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

/** Stamp every link and image in `tree` with its raw URL. */
function stampRawUrls(tree: MarkdownNode): void {
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier !== undefined && node.url !== undefined) {
      definitions.set(node.identifier, node.url);
    }
  });
  walk(tree, (node) => {
    if ((node.type === 'link' || node.type === 'image') && node.url !== undefined) {
      stamp(node, node.url);
    } else if (node.type === 'linkReference' || node.type === 'imageReference') {
      const url = node.identifier === undefined ? undefined : definitions.get(node.identifier);
      if (url !== undefined) stamp(node, url);
    }
  });
}

/** The plugin: react-markdown calls it once per render for the transform to run. */
export function remarkRawUrls(): (tree: MarkdownNode) => void {
  return stampRawUrls;
}
