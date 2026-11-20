/** A URL wrapped in double backticks, which GitHub renders as inline code instead of a link. */
export interface Finding {
  /** 1-based line of the PR body the URL sits on. */
  line: number;
  url: string;
}

// `` then CommonMark's optional single padding space, then the URL up to a space, backtick or `)`.
const DOUBLE_BACKTICKED_URL = /``[ ]?(https?:\/\/[^\s`)]+)/g;
// A fenced code block opens and closes on a line of 3+ backticks or tildes (CommonMark §4.5).
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Finds every URL in a PR description wrapped in double backticks — `[text](``https://…``)` or a
 * bare ``https://…``. Either form breaks the link. Fenced code blocks are skipped, so a body can
 * still quote the broken form inside one.
 */
export function lintPrBody(body: string): Finding[] {
  const findings: Finding[] = [];
  let fence: string | undefined;
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === undefined) {
      if (marker !== undefined) {
        fence = marker;
        continue;
      }
    } else {
      // Closed only by a fence of the same character, at least as long, with nothing after it.
      if (
        marker !== undefined &&
        marker.startsWith(fence.charAt(0)) &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = undefined;
      }
      continue;
    }
    for (const match of line.matchAll(DOUBLE_BACKTICKED_URL)) {
      findings.push({ line: index + 1, url: match[1] ?? '' });
    }
  }
  return findings;
}
