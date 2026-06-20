/**
 * Parse the machine-readable `alfred` block a Software-Factory PR carries.
 *
 * The block is a fenced ```alfred region in the PR description:
 *
 *   ```alfred
 *   alfred-ticket: ALF-42, ALF-43
 *   phase: refinement
 *   spec-path: docs/specs/ALF-42.md
 *   ```
 *
 * This is the ONLY signal the Worker reads — there is no Anthropic session API. So the parse
 * is a small, dependency-free regex (no `yaml` dep), matching the enforcing GitHub check
 * (`alfred-frontmatter.yml`) field-for-field so a PR that passes CI always parses here too.
 */

export type CodePhase = 'refinement' | 'implementation';

export interface AlfredFrontmatter {
  /** Every ref the PR advances. `alfred-ticket` is always parsed as a list. */
  tickets: string[];
  phase: CodePhase;
  /** Declared by refinement PRs only; `undefined` when absent. */
  specPath: string | undefined;
}

/**
 * The fenced block: ```alfred … ``` — capture the body between the fences. The field regexes use
 * `[ \t]*` (horizontal whitespace), NOT `\s*`, for the value separator: `\s` matches newlines, so
 * `alfred-ticket:\s*(.+)` on an empty value line would greedily swallow the newline and capture the
 * NEXT line's text as the ticket. Pinning to spaces/tabs keeps each field on its own line.
 */
// Stryker disable next-line Regex: AT_CEILING — \s+→\s match the same inputs (both need ≥1 whitespace); the only difference is how much leading whitespace lands in the captured block, which is invisible to the unanchored field regexes below.
const BLOCK_RE = /```alfred\s+([\s\S]*?)```/;
const TICKET_RE = /alfred-ticket:[ \t]*(.*)/;
const PHASE_RE = /phase:[ \t]*(refinement|implementation)/;
const SPEC_PATH_RE = /spec-path:[ \t]*(\S+)/;

/**
 * Extract the `alfred` block from a PR body. Returns `undefined` when the body has no block
 * (the PR isn't ours — ignore it) or the block is malformed (missing `alfred-ticket` or `phase`),
 * mirroring the `alfred-frontmatter.yml` enforcing check. A refinement block missing `spec-path` still parses — the
 * transition layer decides what to do without one; CI is what rejects that case on the PR side.
 */
export function parseFrontmatter(body?: string): AlfredFrontmatter | undefined {
  // Stryker disable next-line StringLiteral: AT_CEILING — the ?? fallback only matters when body is undefined, and any non-alfred string (incl. "") yields no block → undefined; the literal value is unobservable.
  const block = BLOCK_RE.exec(body ?? '')?.[1];
  // Stryker disable next-line ConditionalExpression: AT_CEILING — removing this early return is equivalent: with block undefined, TICKET_RE.exec(undefined) coerces to exec("undefined") → no match → the ticketRaw===undefined guard below returns undefined identically.
  if (block === undefined) return undefined;

  const ticketRaw = TICKET_RE.exec(block)?.[1];
  const phase = PHASE_RE.exec(block)?.[1];
  if (ticketRaw === undefined || phase === undefined) return undefined;

  const tickets = ticketRaw
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0);
  if (tickets.length === 0) return undefined;

  return {
    tickets,
    phase: phase as CodePhase,
    specPath: SPEC_PATH_RE.exec(block)?.[1],
  };
}
