/** A URL wrapped in double backticks, which GitHub renders as inline code instead of a link. */
export interface Finding {
  /** 1-based line of the PR body the URL sits on. */
  line: number;
  url: string;
}

// `` then CommonMark's optional single padding space, then an http(s) URL — or, as a link's target
// right after `](`, any href (a root-relative /owner/repo/blob/… is wrapped too) — up to a space,
// backtick or `)`.
const DOUBLE_BACKTICKED_URL = /(?:\]\(``[ ]?([^\s`)]+)|``[ ]?(https?:\/\/[^\s`)]+))/g;
// A fenced code block opens and closes on a line of 3+ backticks or tildes (CommonMark §4.5). A
// backtick fence's info string can't contain a backtick, so ```x``` is an inline code span.
const FENCE = /^ {0,3}(?:(`{3,})[^`]*$|(~{3,}))/;

/**
 * Finds every URL in a PR description wrapped in double backticks — a link target such as
 * `[text](``https://…``)` or `[text](``/owner/repo/…``)`, or a bare ``https://…``. Each breaks the
 * link. Fenced code blocks are skipped, so a body can still quote the broken form inside one.
 */
export function lintPrBody(body: string): Finding[] {
  const findings: Finding[] = [];
  let fence: string | undefined;
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const fenceMatch = FENCE.exec(line);
    const marker = fenceMatch?.[1] ?? fenceMatch?.[2];
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
      findings.push({ line: index + 1, url: match[1] ?? match[2] ?? '' });
    }
  }
  return findings;
}
