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
import type { CodeStory, Epic, Project } from '@/lib/types';

const CLAUDE_CODE_WEB_URL = 'https://claude.ai/code';

/** The refinement skill dropped into each project repo; a refinement session auto-loads it. */
const REFINEMENT_SKILL_PATH = '.claude/skills/refinement/SKILL.md';

/** The epic-refinement skill dropped into each project repo; an epic session auto-loads it. */
const EPIC_REFINEMENT_SKILL_PATH = '.claude/skills/epic-refinement/SKILL.md';

/** The implementation-guide skill; an implementation/bypass session loads it where present. */
const IMPLEMENT_SKILL_PATH = '.claude/skills/implement-spec/SKILL.md';

/** The spike-guide skill dropped into each project repo; a spike session auto-loads it. */
const SPIKE_SKILL_PATH = '.claude/skills/spike/SKILL.md';

/**
 * Document-writing PRs (both refinement phases, and a spike) record where their document ended
 * up rather than alfred guessing it up front. The session's skill — not this prompt — decides the
 * document's shape and location (a single file here, a multi-file folder elsewhere), so the agent
 * replaces this placeholder with the real path.
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
 * The GitHub blob URL for a recorded spec — the "View in repo" link behind both the story detail
 * modal and the epic spec modal. Pinned to the recorded blob sha so the link shows the exact
 * snapshotted revision; falls back to the default branch when no sha is recorded yet. Returns
 * `undefined` when the repo coordinates or the path are missing, i.e. there is nothing to link to.
 */
export function specBlobUrl({
  repoOwner,
  repoName,
  specPath,
  specSha,
}: {
  repoOwner: string | null;
  repoName: string | null;
  specPath: string | null;
  specSha: string | null;
}): string | undefined {
  if (repoOwner === null || repoName === null || specPath === null) return undefined;
  return `https://github.com/${repoOwner}/${repoName}/blob/${specSha ?? 'HEAD'}/${specPath}`;
}

/**
 * The machine-readable PR ↔ ticket block every phase's PR must carry. Kept dead simple
 * so the Worker can regex it: a fenced ```alfred block with `alfred-ticket` + `phase`, plus a
 * `spec-path` line when there's a spec to name. Refinement and implementation PRs pass one (the
 * spec they write / consume); the skip-refinement bypass PR omits it entirely (ALF-75 — there is
 * no committed spec, so naming one only implied a never-read file). CI requires `spec-path` on
 * the two refinement phases and on a spike (whose findings document is the thing to snapshot),
 * so an implementation block is valid without it.
 */
function frontmatterBlock(
  ref: string,
  phase: 'epic-refinement' | 'refinement' | 'implementation' | 'spike',
  specPath?: string,
): string {
  const lines = ['```alfred', `alfred-ticket: ${ref}`, `phase: ${phase}`];
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
 * A short, safe-to-inline context block from a ticket's or epic's notes, or '' when absent.
 * `label` names the source in the heading ('the ticket' / 'the epic notes') so the reader knows
 * which record the context came from. When the notes exceed the inline cap they're clipped, and
 * the agent is TOLD they're clipped (and that the full notes live in alfred, not the repo, so it
 * can't fetch them) — otherwise a model treats the partial context as complete and specs from it
 * with false confidence.
 */
function notesContext(notes: string | null, label: string): string {
  const trimmed = notes?.trim();
  if (trimmed === undefined || trimmed.length === 0) return '';
  if (trimmed.length > MAX_INLINE_NOTES) {
    return `\n\nContext (from ${label} — TRUNCATED; the full notes live in the orchestrator, not this repo, so ask me here if you need the rest):\n${trimmed.slice(0, MAX_INLINE_NOTES)}…`;
  }
  return `\n\nContext (from ${label}):\n${trimmed}`;
}

/**
 * The epic-context paragraph a story prompt carries when the story's epic has a spec: read the
 * epic spec first for the settled high-level decisions, but treat it as BACKGROUND. The
 * don't-archive clause matters because the implementation prompt in the very same message tells
 * the agent to git-move *its own* spec into the archive — an epic spec is long-lived and must
 * never be swept up in that. Returns [] when the epic has no spec: pointing an agent at a file
 * that isn't there is worse than saying nothing.
 */
function epicContextLines(story: CodeStory): string[] {
  const epicSpecPath = story.epic_spec_path;
  if (epicSpecPath === null) return [];
  const epicRef = story.epic_ref ?? '';
  const epicName = story.epic_name ?? '';
  return [
    `Epic context: this story belongs to epic ${epicRef} (${epicName}), whose epic spec is committed at \`${epicSpecPath}\`. Read it first — it carries the high-level decisions and constraints for the whole epic. It is background, NOT this story's spec: don't edit, archive, or move it.`,
    '',
  ];
}

/**
 * The rendered-preview instruction both refinement prompts carry. GitHub serves a committed
 * `.html` file as raw source, so a reviewer who clicks an HTML spec gets markup instead of the
 * plan; htmlpreview.github.io renders it. It lives in the prompt rather than in each repo's
 * refinement skill so every project gets it without the instruction being copy-pasted into — and
 * drifting between — every repo's own skill file. Owner/repo come from the project row; the head
 * branch and spec path are the agent's to fill, since only it knows where the spec landed.
 *
 * Both cases are spelled out because htmlpreview fetches through raw.githubusercontent.com
 * unauthenticated, so it 404s on a private repo — there the best a reviewer can get is the file
 * itself to download and open. We don't store repo visibility, but the session is running inside
 * the repo and can tell.
 */
function htmlPreviewStep(project: Project): string {
  const blobUrl = `https://github.com/${project.repo_owner}/${project.repo_name}/blob/<head-branch>/<spec-path>`;
  return `If the spec is an HTML file, also link it in the description so a reviewer can read the plan rather than the markup — GitHub serves a committed \`.html\` as raw source. On a public repo, route it through htmlpreview: \`https://htmlpreview.github.io/?${blobUrl}\`. htmlpreview can't reach a private repo — if this one is private, link the file directly instead (\`${blobUrl}\`) so the reviewer can download and open it. Either way point at this PR's head branch; the spec isn't on main yet.`;
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
 * The decoded prompt a launch URL carries in its `q` param — the exact text the link prefills.
 *
 * The `q`/`repo` params are correct on the web + desktop surfaces (both are documented aliases of
 * `prompt`/`repositories`), but the mobile Claude app opens the universal link WITHOUT prefilling
 * `q`, so the composer lands empty. The launcher copies this prompt to the clipboard as a
 * paste-fallback for that case, so it needs the prompt back out of the URL it just built. Returns
 * '' when the URL carries no `q`.
 */
export function promptFromLaunchUrl(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
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
    ...epicContextLines(story),
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the spec on the code that already exists.`,
    `2. If the title and context below don't pin down the scope and acceptance criteria, ASK ME HERE before writing the spec — you don't need to guess, I'm in this tab. Otherwise go ahead.`,
    `3. Write the spec following the refinement skill at \`${REFINEMENT_SKILL_PATH}\` (it auto-loads in a refinement session) — it defines this repo's spec format, structure, and where the spec lives. If the skill is absent, write the spec as a single self-contained HTML document and save it under the repo's specs directory.`,
    `4. Open a pull request whose description carries this machine-readable block — the orchestrator (alfred) reads it to advance the ticket and a CI check enforces it. Reproduce the \`alfred-ticket\` and \`phase\` lines exactly, and set \`spec-path\` to where you saved the spec (a file, or the folder for a multi-file spec):`,
    '',
    frontmatterBlock(ref, 'refinement', SPEC_PATH_PLACEHOLDER),
    '',
    `5. ${htmlPreviewStep(project)}`,
    `6. Before opening the PR, confirm the spec is saved, \`spec-path\` above names that spec (not the placeholder), the preview link is there if the spec is HTML, and the block is reproduced exactly.`,
    notesContext(story.notes, 'the ticket'),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * Build the SPIKE link prompt (the single launch a `Spike: …` story offers, from either
 * pre-work state): investigate the question and produce a FINDINGS DOCUMENT ONLY — no
 * implementation, and no feature spec either — then open a PR carrying `phase: spike`.
 *
 * Deliberately the same shape as `buildRefinementUrl`, reusing its shared pieces verbatim (the
 * scannable ref-plus-title first line, the epic-context paragraph, the notes block, the
 * placeholder `spec-path`, the html-preview step, the verbatim-block self-check) — a spike is
 * the same contract with a different deliverable. Like refinement it stays THIN on conventions:
 * the findings' format and location are the spike skill's job, with a one-line fallback for a
 * repo where the skill is absent, so another project can put its findings elsewhere.
 *
 * The one step with no analogue in the sibling prompts is the never-archive line, and it is
 * load-bearing: the implementation prompt in the same family tells the agent to git-move its
 * document into an archive, and a model that has internalised that family resemblance will
 * helpfully do the same here. Findings are long-lived reference material — later sessions keep
 * reading them — so they are never archived and never land in the specs directory.
 */
export function buildSpikeUrl(project: Project, story: CodeStory): string {
  const ref = refOf(story);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are running a SPIKE for the ticket ${ref}. Produce a FINDINGS DOCUMENT ONLY — answer the question and record what you found, in enough detail that a later refinement or implementation session can act on it. Do NOT implement anything (no app or source changes) and do NOT write a feature spec.`,
    '',
    ...epicContextLines(story),
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base your findings on the code that already exists.`,
    `2. If the title and context below don't pin down the question this spike has to answer, ASK ME HERE before investigating — you don't need to guess, I'm in this tab. Otherwise go ahead.`,
    `3. Investigate, then write the findings following the spike skill at \`${SPIKE_SKILL_PATH}\` (it auto-loads in a spike session) — it defines this repo's findings format, structure, and where the document lives. If the skill is absent, write a single self-contained HTML findings document under the repo's spikes directory.`,
    `4. The findings document is LONG-LIVED reference material — later sessions keep reading it. Do not archive or move it, and do not add it to the specs directory.`,
    `5. Open a pull request whose description carries this machine-readable block — the orchestrator (alfred) reads it to advance the ticket and a CI check enforces it. Reproduce the \`alfred-ticket\` and \`phase\` lines exactly, and set \`spec-path\` to where you saved the findings document:`,
    '',
    frontmatterBlock(ref, 'spike', SPEC_PATH_PLACEHOLDER),
    '',
    `6. ${htmlPreviewStep(project)}`,
    `7. Before opening the PR, confirm the findings document is saved, \`spec-path\` above names that document (not the placeholder), the preview link is there, and the block is reproduced exactly.`,
    notesContext(story.notes, 'the ticket'),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * Build the EPIC-REFINEMENT link prompt (the epic 3-dot menu's "Refine epic in Claude Code"):
 * brainstorm and record the epic's high-level context and decisions as ONE epic spec, then open a
 * PR carrying `phase: epic-refinement`. Deliberately the same shape as the story refinement prompt
 * — ref + name lead so the new tab is scannable, format/location stay the *skill's* job (hence the
 * placeholder `spec-path`, not a hardcoded path), and the clarification gate + verbatim-block
 * self-check are kept.
 *
 * Two things set it apart from the story prompt. It forbids per-story specs as well as
 * implementation: individual stories are refined in their own sessions, and pre-empting them here
 * would produce specs no story ever consumes. And an epic has at most ONE spec — when the epic
 * already carries a `spec_path`, the prompt names it and says to update it in place, so refining
 * an epic repeatedly revises one document instead of accumulating rival ones.
 */
export function buildEpicRefinementUrl(project: Project, epic: Epic): string {
  const existingSpec = epic.spec_path;
  const prompt = [
    `${epic.ref}: ${epic.name}`,
    '',
    `You are refining the EPIC ${epic.ref}. Produce an EPIC SPEC ONLY — a high-level context and decisions document for the epic as a whole. Do NOT implement anything, and do NOT write per-story specs (individual stories are refined in their own sessions).`,
    '',
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base the epic spec on the code that already exists.`,
    `2. If the epic name and context below don't pin down the problem space and the decisions worth recording, ASK ME HERE before writing — you don't need to guess, I'm in this tab. Brainstorming the epic with me is the point of this session.`,
    `3. Write the epic spec following the epic-refinement skill at \`${EPIC_REFINEMENT_SKILL_PATH}\` (it auto-loads in an epic-refinement session) — it defines this repo's epic-spec format, structure, and where the spec lives. If the skill is absent, write it as a single self-contained HTML document under the repo's specs directory.${
      existingSpec === null
        ? ''
        : ` This epic already has a spec committed at \`${existingSpec}\` — UPDATE that file in place rather than adding a second one.`
    }`,
    `4. Open a pull request whose description carries this machine-readable block — the orchestrator (alfred) reads it to attach the spec to the epic and a CI check enforces it. Reproduce the \`alfred-ticket\` and \`phase\` lines exactly, and set \`spec-path\` to where you saved the spec:`,
    '',
    frontmatterBlock(epic.ref, 'epic-refinement', SPEC_PATH_PLACEHOLDER),
    '',
    `5. ${htmlPreviewStep(project)}`,
    `6. Before opening the PR, confirm the spec is saved, \`spec-path\` above names that spec (not the placeholder), the preview link is there if the spec is HTML, and the block is reproduced exactly.`,
    notesContext(epic.notes, 'the epic notes'),
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
  // not-yet-recorded path still yields a usable link. The launch path no longer reaches that
  // fallback — `buildDevelopmentUrl` routes a spec-less story to the bypass prompt instead — so
  // it stands as belt-and-braces for any direct caller.
  const specPath = story.spec_path ?? specPathFor(story);
  const archivePath = archivePathFor(specPath);
  const prompt = [
    `${ref}: ${titleOf(story)}`,
    '',
    `You are implementing the ticket ${ref}. Implement the merged spec committed at \`${specPath}\` in this repo — read it first, then build it.`,
    '',
    ...epicContextLines(story),
    `Ground yourself first: skim the repo and honor its own conventions (read any CONTRIBUTING or CLAUDE.md). If the merged spec is ambiguous or has drifted from the current code, ASK ME HERE before building rather than guessing — I'm in this tab. Follow the implement-spec skill at \`${IMPLEMENT_SKILL_PATH}\` where present — it owns the conventions for building from a spec (archiving the consumed spec, pinning each requirement with a test).`,
    '',
    // The spec is scaffolding: once it's built, retire it from the active specs directory so
    // only specs still awaiting implementation remain there. The alfred-frontmatter check fails
    // the PR if the spec is left un-archived, so the move is part of the implementation PR.
    `When the change is built, ARCHIVE the spec in this same PR: git-move \`${specPath}\` to \`${archivePath}\` (keep the block's spec-path below pointing at the original path). A CI check fails the PR if \`${specPath}\` is still sitting un-archived in the active specs directory.`,
    '',
    `When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly:`,
    '',
    frontmatterBlock(ref, 'implementation', specPath),
    '',
    `Before opening the PR, confirm your changes satisfy the spec's acceptance criteria, the spec is archived at \`${archivePath}\`, and the block above is reproduced exactly.`,
    notesContext(story.notes, 'the ticket'),
  ].join('\n');
  return buildUrl(project, prompt);
}

/**
 * The development-launch prompt for a story in `ready_for_dev`: the spec-reading implementation
 * prompt when a refinement PR actually recorded a spec, and the SKIP-REFINEMENT prompt when it did
 * not. `spec_path` is the only honest test — the Worker sets it when a refinement PR merges, so a
 * null means no committed spec exists, however the story reached this lane. Two routes get it
 * there without one: clearing the "Needs refinement" mark, and the Worker's revert of a
 * closed-unmerged implementation PR. Both used to hand the agent an implementation prompt naming a
 * spec file that was never written.
 */
export function buildDevelopmentUrl(project: Project, story: CodeStory): string {
  return story.spec_path === null
    ? buildBypassUrl(project, story)
    : buildImplementationUrl(project, story);
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
    ...epicContextLines(story),
    `1. Ground yourself first: skim the repo and honor its own conventions — read any CONTRIBUTING or CLAUDE.md — and base your work on the code that already exists.`,
    `2. If the title and context below don't pin down the scope, ASK ME HERE before building rather than guessing — you don't need to guess, I'm in this tab. Once the plan is settled, go ahead.`,
    `3. Implement the change directly, following the repo's own conventions (tests/TDD included) — pin each requirement with a test.`,
    `4. When done, open a pull request whose description carries this machine-readable block verbatim — a CI check enforces it, so reproduce the fence exactly:`,
    '',
    frontmatterBlock(ref, 'implementation'),
    '',
    `5. Before opening the PR, confirm your changes satisfy the agreed plan and the block above is reproduced exactly.`,
    notesContext(story.notes, 'the ticket'),
  ].join('\n');
  return buildUrl(project, prompt);
}
