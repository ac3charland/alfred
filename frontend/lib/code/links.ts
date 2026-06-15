/**
 * Pure builders for the Claude Code Web "open a session" deep links (§11).
 *
 * A human clicks one of these to open a claude.ai/code tab with the repo + a prompt
 * PREFILLED but NOT auto-executed (the ToS-clean human launch, §1/§11.1). Both links are
 * derived ENTIRELY from stored data (the project's repo coordinates + the story's ref /
 * title / notes / spec_path), so the URL is always fresh and we persist no URLs.
 *
 * URL contract (verified against https://code.claude.com/docs/en/web-quickstart, June 2026):
 *   https://claude.ai/code?repo=<owner>/<name>&prompt=<urlencoded prompt>
 * - `repo` is the documented alias for `repositories` (single `owner/name` is fine).
 * - `prompt` prefills the composer (alias `q`); the surface prefills-only, no auto-submit.
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

/** A short, safe-to-inline context block from the story's notes (§11.2), or '' when absent. */
function notesContext(story: CodeStory): string {
  const notes = story.notes?.trim();
  if (notes === undefined || notes.length === 0) return '';
  const truncated =
    notes.length > MAX_INLINE_NOTES ? `${notes.slice(0, MAX_INLINE_NOTES)}…` : notes;
  return `\n\nContext (from the ticket):\n${truncated}`;
}

/** Assemble the final claude.ai/code URL with the repo + the URL-encoded prompt. */
function buildUrl(project: Project, prompt: string): string {
  const parameters = new URLSearchParams({
    repo: `${project.repo_owner}/${project.repo_name}`,
    prompt,
  });
  return `${CLAUDE_CODE_WEB_URL}?${parameters.toString()}`;
}

/**
 * Build the REFINEMENT link prompt (active in `needs_refinement`): write a spec markdown
 * artifact only — NO implementation — following the project's refinement guide, save it to
 * `specs/<REF>.md`, and open a PR carrying the §12 block with `phase: refinement`. Ref + title
 * lead the prompt so the new browser tab is scannable (§11.2).
 */
export function buildRefinementUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  const specPath = specPathFor(story);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are refining the alfred ticket ${ref}. Write a SPEC ONLY for this story — do NOT implement anything yet.`,
    '',
    `Follow the project's refinement guide at \`${REFINEMENT_GUIDE_PATH}\` (a proposed convention — this path is not yet finalized; if it is absent, write an OpenSpec-style spec). Save the spec to \`${specPath}\`.`,
    '',
    `Then open a pull request whose description carries this machine-readable block exactly (alfred reads it to advance the ticket):`,
    '',
    frontmatterBlock(story, 'refinement', specPath),
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * Build the IMPLEMENTATION link prompt (active in `ready_for_dev`, after the spec PR merged):
 * implement the merged spec at the story's recorded `spec_path` (falling back to the
 * conventional path), and open a PR carrying the §12 block with `phase: implementation`.
 * References the committed spec file — does NOT inline the spec body (§11.1).
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
    `When done, open a pull request whose description carries this machine-readable block exactly (alfred reads it to advance the ticket):`,
    '',
    frontmatterBlock(story, 'implementation', specPath),
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}
