/**
 * Pure builders for the Claude Code Web "open a session" deep links.
 *
 * A human clicks one of these to open a claude.ai/code tab with the repo + a prompt
 * PREFILLED but NOT auto-executed (the ToS-clean human launch — prefilled, never
 * auto-submitted). Both links are
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
 *   prompts REFERENCE the committed spec file and never inline the whole spec/notes.
 * - No branch/`ref` URL param is documented (the session UI has a branch selector instead).
 */
import type { CodeStory, Project } from '@/lib/types';

const CLAUDE_CODE_WEB_URL = 'https://claude.ai/code';

/** The refinement skill dropped into each project repo; a refinement session auto-loads it. */
const REFINEMENT_SKILL_PATH = '.claude/skills/refinement/SKILL.md';

/** The implementation-guide skill; an implementation/bypass session loads it where present. */
const IMPLEMENT_SKILL_PATH = '.claude/skills/implement-spec/SKILL.md';

/**
 * Refinement PRs record where the spec ended up rather than alfred guessing it up front. The
 * refinement skill — not this prompt — decides the spec's shape and location (a single file here,
 * a multi-file folder elsewhere), so the agent replaces this placeholder with the real path.
 */
const SPEC_PATH_PLACEHOLDER = '<path-or-folder-of-the-spec>';

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

/**
 * The conventional spec location for a story (`docs/specs/<REF>.html`). The spec is authored as
 * a self-contained HTML plan (see `buildRefinementUrl`), so the path carries the `.html`
 * extension; the Worker's `spec-path` and the `alfred-frontmatter` check are both
 * extension-agnostic, so the file type is ours to choose here.
 */
function specPathFor(story: CodeStory): string {
  return `docs/specs/${refOf(story)}.html`;
}

/**
 * Where a spec moves once its story is implemented: `docs/specs/archive/<basename>`. The
 * implementation PR git-moves the spec out of the active `docs/specs/` directory into the
 * archive, retiring the now-consumed scaffolding so the active directory only ever holds specs
 * still awaiting implementation. The `alfred-frontmatter` check enforces the move (it fails an
 * implementation PR whose `spec-path` still resolves to a file in the active directory). Derived
 * from the spec path's basename so it works whatever extension the spec used (`.html`/`.md`).
 */
function archivePathFor(specPath: string): string {
  const basename = specPath.slice(specPath.lastIndexOf('/') + 1);
  return `docs/specs/archive/${basename}`;
}

/**
 * The machine-readable PR ↔ ticket block every phase's PR must carry. Kept dead simple
 * so the Worker can regex it: a fenced ```alfred block with `alfred-ticket` + `phase`, plus a
 * `spec-path` line when there's a spec to name. Refinement and implementation PRs pass one (the
 * spec they write / consume); the skip-refinement bypass PR omits it entirely (ALF-75 — there is
 * no committed spec, so naming one only implied a never-read file). CI requires `spec-path` on
 * refinement PRs only, so an implementation block is valid without it.
 */
function frontmatterBlock(
  story: CodeStory,
  phase: 'refinement' | 'implementation',
  specPath?: string,
): string {
  const lines = ['```alfred', `alfred-ticket: ${refOf(story)}`, `phase: ${phase}`];
  if (specPath !== undefined) lines.push(`spec-path: ${specPath}`);
  lines.push('```');
  return lines.join('\n');
}

/**
 * Max characters of the story's notes to inline as context. Notes are "short, safe to
 * inline", but a pathologically long notes field must not blow the prompt past the
 * desktop ~14k cap — so cap it and let the spec file carry the full detail.
 */
const MAX_INLINE_NOTES = 1000;

/**
 * A short, safe-to-inline context block from the story's notes, or '' when absent.
 * When the notes exceed the inline cap they're clipped, and the agent is TOLD they're clipped
 * (and that the full notes live in alfred, not the repo, so it can't fetch them) — otherwise a
 * model treats the partial context as complete and specs from it with false confidence.
 */
function notesContext(story: CodeStory): string {
  const notes = story.notes?.trim();
  if (notes === undefined || notes.length === 0) return '';
  if (notes.length > MAX_INLINE_NOTES) {
    return `\n\nContext (from the ticket — TRUNCATED; the full notes live in the orchestrator, not this repo, so ask me here if you need the rest):\n${notes.slice(0, MAX_INLINE_NOTES)}…`;
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
 * Build the REFINEMENT link prompt (active in `needs_refinement`): write a spec artifact only —
 * NO implementation — following the project's refinement skill, then open a PR carrying the
 * machine-readable ticket block with `phase: refinement`. Ref + title lead the prompt so the new
 * browser tab is scannable.
 *
 * The prompt is deliberately THIN on spec conventions. HOW the spec is shaped (format, sections)
 * and WHERE it lives are the refinement skill's job, so each project owns its own refinement
 * conventions — a single self-contained HTML plan here, an OpenSpec change folder elsewhere —
 * while still hooking into alfred through the one shared contract, the `alfred` block. So the
 * prompt does NOT hardcode the spec's path or format: the agent saves the spec wherever its skill
 * says and records that real `spec-path` (a file, or a folder for a multi-file spec) in the block.
 * A one-line fallback (write a self-contained HTML doc) covers a repo where the skill is absent.
 *
 * What the prompt DOES keep are the project-agnostic guardrails that stop a smaller model
 * one-shotting a confidently-wrong spec: ground in the repo first, a clarification gate so a thin
 * ticket gets questions instead of invented scope, and a verbatim-block self-check.
 */
export function buildRefinementUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are refining the ticket ${ref}. Produce a SPEC ONLY — describe the concrete change in enough detail that a later session can build it, but do NOT implement anything yet (no app or source changes).`,
    '',
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the spec on the code that already exists.`,
    `2. If the title and context below don't pin down the scope and acceptance criteria, ASK ME HERE before writing the spec — you don't need to guess, I'm in this tab. Otherwise go ahead.`,
    `3. Write the spec following the refinement skill at \`${REFINEMENT_SKILL_PATH}\` (it auto-loads in a refinement session) — it defines this repo's spec format, structure, and where the spec lives. If the skill is absent, write the spec as a single self-contained HTML document and save it under the repo's specs directory.`,
    `4. Open a pull request whose description carries this machine-readable block — the orchestrator (alfred) reads it to advance the ticket and a CI check enforces it. Reproduce the \`alfred-ticket\` and \`phase\` lines exactly, and set \`spec-path\` to where you saved the spec (a file, or the folder for a multi-file spec):`,
    '',
    frontmatterBlock(story, 'refinement', SPEC_PATH_PLACEHOLDER),
    '',
    `5. Before opening the PR, confirm the spec is saved, \`spec-path\` above names that spec (not the placeholder), and the block is reproduced exactly.`,
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * Build the IMPLEMENTATION link prompt (active in `ready_for_dev`, after the spec PR merged):
 * implement the merged spec at the story's recorded `spec_path` (falling back to the
 * conventional path), archive that now-consumed spec, and open a PR carrying the
 * machine-readable ticket block with `phase: implementation`.
 * References the committed spec file — does NOT inline the spec body, and stays format-agnostic
 * (the spec may be HTML, markdown, or a multi-file folder — whatever the refinement skill chose).
 * Carries the same shared guardrails as refinement (ground in the repo, ask when the spec is
 * ambiguous/stale, verbatim-block self-check) and points at the implement-spec skill for the
 * archiving convention, while keeping the CI-enforced archive step inline as the system hook.
 */
export function buildImplementationUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  // Prefer the path the refinement PR declared; fall back to the conventional location so a
  // not-yet-recorded path still yields a usable link.
  const specPath = story.spec_path ?? specPathFor(story);
  const archivePath = archivePathFor(specPath);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are implementing the ticket ${ref}. Implement the merged spec committed at \`${specPath}\` in this repo — read it first, then build it.`,
    '',
    `Ground yourself first: skim the repo and honor its own conventions (read any CONTRIBUTING or CLAUDE.md). If the merged spec is ambiguous or has drifted from the current code, ASK ME HERE before building rather than guessing — I'm in this tab. Follow the implement-spec skill at \`${IMPLEMENT_SKILL_PATH}\` where present — it owns the conventions for building from a spec (archiving the consumed spec, pinning each requirement with a test).`,
    '',
    // The spec is scaffolding: once it's built, retire it from the active specs directory so
    // only specs still awaiting implementation remain there. The alfred-frontmatter check fails
    // the PR if the spec is left un-archived, so the move is part of the implementation PR.
    `When the change is built, ARCHIVE the spec in this same PR: git-move \`${specPath}\` to \`${archivePath}\` (keep the block's spec-path below pointing at the original path). A CI check fails the PR if \`${specPath}\` is still sitting un-archived in the active specs directory.`,
    '',
    `When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly:`,
    '',
    frontmatterBlock(story, 'implementation', specPath),
    '',
    `Before opening the PR, confirm your changes satisfy the spec's acceptance criteria, the spec is archived at \`${archivePath}\`, and the block above is reproduced exactly.`,
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * Build the BYPASS link prompt (the "Skip to Development" launch from `needs_refinement`): a
 * BLEND of the refinement and implementation prompts for a small, well-understood task that
 * doesn't warrant a separate spec PR. There is NO committed spec, so — unlike
 * `buildImplementationUrl` — the prompt must NOT tell the agent to read a spec file. Instead it
 * carries the refinement prompt's clarification gate (ask before building when scope is unclear),
 * then once the plan is settled it implements directly, and opens ONE PR carrying the
 * `phase: implementation` block (so the Worker advances the ticket through the normal
 * implementation transitions — no refinement PR, no spec file). Ref + title lead the prompt so
 * the new tab is scannable.
 *
 * There is NO spec to archive (unlike `buildImplementationUrl`), so the prompt carries no archive
 * step. And unlike the other two phases (ALF-75), the prompt neither reads the implement-spec skill
 * (which owns spec-consuming conventions this session has no spec for) nor names a `spec-path` in
 * the block — pointing at either only invited never-read spec files. It leans on the repo's own
 * conventions for the build, and the `alfred-frontmatter` check passes because the block carries no
 * `spec-path` (required on refinement PRs only) and no file is left un-archived.
 */
export function buildBypassUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are implementing the ticket ${ref}. This is a SKIP-REFINEMENT session: there is NO committed spec to read — settle the plan here, then build it directly in this one session.`,
    '',
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base your work on the code that already exists.`,
    `2. If the title and context below don't pin down the scope, ASK ME HERE before building rather than guessing — you don't need to guess, I'm in this tab. Once the plan is settled, go ahead.`,
    `3. Implement the change directly, following the repo's own conventions (tests/TDD included) — pin each requirement with a test.`,
    `4. When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly:`,
    '',
    frontmatterBlock(story, 'implementation'),
    '',
    `5. Before opening the PR, confirm your changes satisfy the agreed plan and the block above is reproduced exactly.`,
    notesContext(story),
  ].join('\n');
  return buildUrl(project, prompt);
}
