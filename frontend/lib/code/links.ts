/**
 * Pure builders for the Claude Code Web "open a session" deep links (§11).
 *
 * A human clicks one of these to open a claude.ai/code tab with the repo + a prompt
 * PREFILLED but NOT auto-executed (the ToS-clean human launch, §1/§11.1). Both links are
 * derived ENTIRELY from stored data (the project's repo coordinates + the story's ref /
 * title / notes / spec_path), so the URL is always fresh and we persist no URLs.
 *
 * URL contract (verified against https://code.claude.com/docs/en/web-quickstart, June 2026):
 *   https://claude.ai/code?repo=<owner>/<name>&q=<urlencoded prompt>
 * - `repo` is the documented alias for `repositories` (single `owner/name` is fine).
 * - `q` prefills the composer (alias `prompt`); the surface prefills-only, no auto-submit.
 *   We emit `q` (not `prompt`) because it's the param the mobile Claude app's universal-link
 *   composer reads — the web surface accepts both, so `q` prefills on phone AND desktop, while
 *   `prompt` silently no-ops in the app. This is also why no mobile detection is needed: the
 *   same claude.ai/code link is a universal link the OS hands off to the app, or opens in the
 *   browser when the app is absent.
 * - The web docs state NO character cap, but the desktop app reportedly truncates ~14k, so
 *   prompts REFERENCE the committed spec file and never inline the whole spec/notes (§11.1).
 * - No branch/`ref` URL param is documented (the session UI has a branch selector instead).
 */
import type { CodeStory, Project } from '@/lib/types';

const CLAUDE_CODE_WEB_URL = 'https://claude.ai/code';

/** The proposed refinement-guide convention path (§11.2). Not finalized — see §17. */
const REFINEMENT_GUIDE_PATH = '.alfred/refinement.md';

/**
 * The story's ref / title as plain strings. `CodeStory` is the `v_code_stories` VIEW row, so
 * its generated type makes every column nullable even though the view's inner joins always
 * return a fully-resolved row (the same gotcha `lib/data/code.ts` documents). Coalesce here so
 * the builders stay pure and total.
 */
function refOf(story: CodeStory): string {
  return story.ref ?? '';
}
function titleOf(story: CodeStory): string {
  return story.title ?? '';
}

/** The conventional spec location for a story (`specs/<REF>.md`, §11.2). */
function specPathFor(story: CodeStory): string {
  return `specs/${refOf(story)}.md`;
}

/**
 * The machine-readable PR ↔ ticket block every phase's PR must carry (§12). Kept dead simple
 * so the Worker can regex it: a fenced ```alfred block with `alfred-ticket` + `phase`, plus
 * `spec-path` on refinement PRs only.
 */
function frontmatterBlock(
  story: CodeStory,
  phase: 'refinement' | 'implementation',
  specPath: string,
): string {
  const lines = [
    '```alfred',
    `alfred-ticket: ${refOf(story)}`,
    `phase: ${phase}`,
    // spec-path is declared on refinement PRs (so Alfred renders the recorded path, §10/§12);
    // including it on the implementation PR too is harmless and keeps the block uniform.
    `spec-path: ${specPath}`,
    '```',
  ];
  return lines.join('\n');
}

/**
 * Max characters of the story's notes to inline as context. Notes are "short, safe to
 * inline" per §11.2, but a pathologically long notes field must not blow the prompt past the
 * desktop ~14k cap (§11.1) — so cap it and let the spec file carry the full detail.
 */
const MAX_INLINE_NOTES = 1000;

/**
 * A short, safe-to-inline context block from the story's notes (§11.2), or '' when absent.
 * When the notes exceed the inline cap they're clipped, and the agent is TOLD they're clipped
 * (and that the full notes live in alfred, not the repo, so it can't fetch them) — otherwise a
 * model treats the partial context as complete and specs from it with false confidence.
 */
function notesContext(story: CodeStory): string {
  const notes = story.notes?.trim();
  if (notes === undefined || notes.length === 0) return '';
  if (notes.length > MAX_INLINE_NOTES) {
    return `\n\nContext (from the ticket — TRUNCATED; the full notes live in alfred, not this repo, so ask me here if you need the rest):\n${notes.slice(0, MAX_INLINE_NOTES)}…`;
  }
  return `\n\nContext (from the ticket):\n${notes}`;
}

/** Assemble the final claude.ai/code URL with the repo + the URL-encoded prompt. */
function buildUrl(project: Project, prompt: string): string {
  const parameters = new URLSearchParams({
    repo: `${project.repo_owner}/${project.repo_name}`,
    q: prompt,
  });
  return `${CLAUDE_CODE_WEB_URL}?${parameters.toString()}`;
}

/**
 * Build the REFINEMENT link prompt (active in `needs_refinement`): write a spec markdown
 * artifact only — NO implementation — following the project's refinement guide, save it to
 * `specs/<REF>.md`, and open a PR carrying the §12 block with `phase: refinement`. Ref + title
 * lead the prompt so the new browser tab is scannable (§11.2).
 *
 * The body carries the agentic guardrails directly (not just in the guide, which may be absent
 * for the target repo): ground in the repo first, a clarification gate so a thin ticket gets
 * questions instead of invented scope, a self-contained section skeleton for the no-guide
 * fallback, and a verbatim-block self-check. These are what stop a smaller model from
 * one-shotting a confidently-wrong spec.
 */
export function buildRefinementUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  const specPath = specPathFor(story);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are refining the alfred ticket ${ref}. Produce a SPEC ONLY — describe the concrete change in enough detail that a later session can build it, but do NOT implement anything yet (no app or source changes).`,
    '',
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the spec on the code that already exists.`,
    `2. If the title and context below don't pin down the scope and acceptance criteria, ASK ME HERE before writing the spec — you don't need to guess, I'm in this tab. Otherwise go ahead.`,
    `3. Write the spec following the project's refinement guide at \`${REFINEMENT_GUIDE_PATH}\` (a proposed convention — not yet finalized). If that file is absent, cover these sections: Title, Context/problem, Proposed change, Acceptance criteria, Out of scope / open questions. Save it to \`${specPath}\`.`,
    `4. Open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly (alfred reads it to advance the ticket):`,
    '',
    frontmatterBlock(story, 'refinement', specPath),
    '',
    `5. Before opening the PR, confirm the spec is saved at \`${specPath}\` and the block above is reproduced exactly.`,
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * Build the IMPLEMENTATION link prompt (active in `ready_for_dev`, after the spec PR merged):
 * implement the merged spec at the story's recorded `spec_path` (falling back to the
 * conventional path), and open a PR carrying the §12 block with `phase: implementation`.
 * References the committed spec file — does NOT inline the spec body (§11.1). Carries the same
 * shared guardrails as refinement (ground in the repo, ask when the spec is ambiguous/stale,
 * verbatim-block self-check) so the implementation path isn't the thinner instruction set.
 */
export function buildImplementationUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  // Prefer the path the refinement PR declared; fall back to the conventional location so a
  // not-yet-recorded path still yields a usable link.
  const specPath = story.spec_path ?? specPathFor(story);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are implementing the alfred ticket ${ref}. Implement the merged spec committed at \`${specPath}\` in this repo — read it first, then build it.`,
    '',
    `Ground yourself first: skim the repo and honor its own conventions (read any CONTRIBUTING or CLAUDE.md). If the merged spec is ambiguous or has drifted from the current code, ASK ME HERE before building rather than guessing — I'm in this tab.`,
    '',
    `When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly (alfred reads it to advance the ticket):`,
    '',
    frontmatterBlock(story, 'implementation', specPath),
    '',
    `Before opening the PR, confirm your changes satisfy the spec's acceptance criteria and the block above is reproduced exactly.`,
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}
