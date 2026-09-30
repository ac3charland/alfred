import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A scripted git repo with the history shapes the ledger has to resolve: two versions of a tiny
 * builder file (the first emitting `prompt=`, the second `q=`), skills and specs appearing over
 * time, a PR branch that merges main in and gets a human commit after it opens, and a branch
 * forked from an old commit. Every author, committer and date is fixed, so the commit shas are
 * the same on every machine — which is what lets a golden file pin them.
 *
 * The tests build it in a temp dir; `npm run fixture-repo -w tools/session-ledger -- <dir>`
 * builds the same repo for the demo doc.
 */

const CLAUDE = { name: 'Claude', email: 'noreply@anthropic.com' };
const HUMAN = { name: 'Fixture Owner', email: 'owner@example.com' };

/** v1 of the builder file: two builders, the old `prompt=` parameter. */
const LINKS_V1 = `import type { CodeStory, Project } from '@/lib/types';

const IMPLEMENT_SKILL = '.claude/skills/implement-spec/SKILL.md';

function buildUrl(project: Project, prompt: string): string {
  return \`https://claude.ai/code?repo=\${String(project.repo_owner)}/\${String(project.repo_name)}&prompt=\${encodeURIComponent(prompt)}\`;
}

export function buildRefinementUrl(project: Project, story: CodeStory): string {
  return buildUrl(project, [\`\${story.ref}: \${story.title}\`, 'Refine it into a spec.'].join('\\n'));
}

export function buildImplementationUrl(project: Project, story: CodeStory): string {
  return buildUrl(
    project,
    [
      \`\${story.ref}: \${story.title}\`,
      \`Implement the spec at \\\`\${story.spec_path}\\\`, following \\\`\${IMPLEMENT_SKILL}\\\` where present.\`,
      story.notes ?? '',
    ].join('\\n'),
  );
}
`;

/** v2: every lane, the `q=` parameter, and the review step naming a second skill. */
const LINKS_V2 = `import type { CodeStory, Epic, Project } from '@/lib/types';

const IMPLEMENT_SKILL = '.claude/skills/implement-spec/SKILL.md';
const REVIEW_SKILL = '.claude/skills/adversarial-review/SKILL.md';
const REFINEMENT_SKILL = '.claude/skills/refinement/SKILL.md';
const EPIC_SKILL = '.claude/skills/implement-epic/SKILL.md';
const BUG_SKILL = '.claude/skills/bug/SKILL.md';

function buildUrl(project: Project, prompt: string): string {
  const url = new URL('https://claude.ai/code');
  url.searchParams.set('repo', \`\${String(project.repo_owner)}/\${String(project.repo_name)}\`);
  url.searchParams.set('q', prompt);
  return url.toString();
}

const review = \`Then run one review round per \\\`\${REVIEW_SKILL}\\\`.\`;

export function buildRefinementUrl(project: Project, story: CodeStory): string {
  return buildUrl(
    project,
    [
      \`\${story.ref}: \${story.title}\`,
      \`Refine it into a spec, following \\\`\${REFINEMENT_SKILL}\\\`.\`,
      \`Epic spec: \${story.epic_spec_path ?? 'none yet'}\`,
      \`Existing spec: \${story.spec_path ?? 'none yet'}\`,
    ].join('\\n'),
  );
}

export function buildSpikeUrl(project: Project, story: CodeStory): string {
  return buildUrl(project, [\`\${story.ref}: \${story.title}\`, 'Research it.'].join('\\n'));
}

export function buildBugUrl(project: Project, story: CodeStory): string {
  if ((story.notes ?? '').includes('explode')) throw new Error('builder bug');
  return buildUrl(
    project,
    [\`\${story.ref}: \${story.title}\`, \`Fix it per \\\`\${BUG_SKILL}\\\`.\`, review].join('\\n'),
  );
}

export function buildEpicRefinementUrl(project: Project, epic: Epic): string {
  return buildUrl(project, [\`\${epic.ref}: \${epic.name}\`, \`Epic spec: \${epic.spec_path ?? 'none yet'}\`].join('\\n'));
}

export function buildEpicImplementationUrl(project: Project, epic: Epic): string {
  return buildUrl(
    project,
    [
      \`\${epic.ref}: \${epic.name}\`,
      \`Build the epic spec at \\\`\${epic.spec_path ?? 'none'}\\\` per \\\`\${EPIC_SKILL}\\\`.\`,
    ].join('\\n'),
  );
}

export function buildImplementationUrl(project: Project, story: CodeStory): string {
  return buildUrl(
    project,
    [
      \`\${story.ref}: \${story.title}\`,
      \`Implement the spec at \\\`\${story.spec_path}\\\`, following \\\`\${IMPLEMENT_SKILL}\\\` where present.\`,
      review,
      story.notes ?? '',
    ].join('\\n'),
  );
}

export function buildBypassUrl(project: Project, story: CodeStory): string {
  return buildUrl(project, [\`\${story.ref}: \${story.title}\`, 'Build it directly.', review].join('\\n'));
}
`;

/** The shas a test or golden file refers to, by the role each commit plays. */
export interface FixtureRepo {
  dir: string;
  /** v1 builder + the implement-spec, refinement and implement-epic skills (1 Jul). */
  c1: string;
  /** The ALF-9 spec lands (2 Jul). */
  c2: string;
  /** A human commit on main while PR 1 is open (3 Jul 11:15). */
  c3: string;
  /** PR 1's branch: a Claude commit, a merge of main, then a human commit after open. */
  a1: string;
  aMerge: string;
  a2: string;
  /** PR 1 merged into main (3 Jul 13:00). */
  m1: string;
  /** v2 builder lands (10 Jul 00:00). */
  c4: string;
  /** The adversarial-review skill, the bug skill and the ALF-4 epic spec land (10 Jul 00:10). */
  c5: string;
  /** PR 2's branch off c5 (a Claude commit), merged by the owner as m2 (10 Jul 03:00). */
  fb1: string;
  m2: string;
  /** An unmerged branch off m2 (11 Jul 05:00) — the head of the later fixture PRs. */
  fc1: string;
  /** A branch forked from c1 and never merged — a session that didn't start from main. */
  b1: string;
}

interface Author {
  name: string;
  email: string;
}

/** Pin author and committer, name and date — the inputs of a commit's sha. */
function identity(author: Author, iso: string): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
    GIT_COMMITTER_DATE: iso,
  };
}

function makeGit(dir: string) {
  return (args: readonly string[], env: Record<string, string> = {}): string => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  };
}

/** Build the fixture repo in `dir` (created if absent; must not already be a repo). */
export function buildFixtureRepo(dir: string): FixtureRepo {
  mkdirSync(dir, { recursive: true });
  const git = makeGit(dir);

  const write = (file: string, content: string): void => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  const commit = (author: Author, iso: string, message: string): string => {
    git(['add', '--all']);
    git(['commit', '--quiet', '--allow-empty', '-m', message], identity(author, iso));
    return git(['rev-parse', 'HEAD']);
  };
  const merge = (author: Author, iso: string, ref: string, message: string): string => {
    git(['merge', '--quiet', '--no-ff', '-m', message, ref], identity(author, iso));
    return git(['rev-parse', 'HEAD']);
  };

  git(['init', '--quiet', '--initial-branch=main']);

  write('frontend/lib/code/links.ts', LINKS_V1);
  write('.claude/skills/implement-spec/SKILL.md', '# implement-spec v1\n');
  write('.claude/skills/refinement/SKILL.md', '# refinement v1\n');
  write('.claude/skills/implement-epic/SKILL.md', '# implement-epic v1\n');
  const c1 = commit(CLAUDE, '2026-07-01T00:00:00Z', 'feat(code): add the launch builders');

  write('docs/specs/ALF-9.html', '<h1>ALF-9 spec</h1>\n');
  const c2 = commit(HUMAN, '2026-07-02T00:00:00Z', 'docs(specs): add alf-9');

  // PR 1's branch grows from c2, merges main back in, and takes a human commit after it opened.
  git(['checkout', '--quiet', '-b', 'feature-a']);
  write('src/feature-a.ts', 'export const a = 1;\n');
  const a1 = commit(CLAUDE, '2026-07-03T10:00:00Z', 'feat(a): first cut');

  git(['checkout', '--quiet', 'main']);
  write('src/main-side.ts', 'export const m = 1;\n');
  const c3 = commit(HUMAN, '2026-07-03T11:15:00Z', 'chore(main): unrelated owner commit');

  git(['checkout', '--quiet', 'feature-a']);
  const aMerge = merge(CLAUDE, '2026-07-03T11:30:00Z', 'main', 'Merge main into feature-a');
  write('src/feature-a.ts', 'export const a = 2;\n');
  const a2 = commit(HUMAN, '2026-07-03T12:00:00Z', 'fix(a): owner rework');

  git(['checkout', '--quiet', 'main']);
  const m1 = merge(HUMAN, '2026-07-03T13:00:00Z', 'feature-a', 'Merge pull request #1');

  write('frontend/lib/code/links.ts', LINKS_V2);
  const c4 = commit(CLAUDE, '2026-07-10T00:00:00Z', 'feat(code): every lane, q parameter');

  write('.claude/skills/adversarial-review/SKILL.md', '# adversarial-review v1\n');
  write('.claude/skills/bug/SKILL.md', '# bug v1\n');
  write('docs/specs/epics/ALF-4.html', '<h1>ALF-4 epic spec</h1>\n');
  const c5 = commit(
    CLAUDE,
    '2026-07-10T00:10:00Z',
    'feat(skills): review and bug skills, alf-4 spec',
  );

  git(['checkout', '--quiet', '-b', 'feature-b']);
  write('src/feature-b.ts', 'export const b = 1;\n');
  const fb1 = commit(CLAUDE, '2026-07-10T02:00:00Z', 'feat(b): implement alf-9');
  git(['checkout', '--quiet', 'main']);
  const m2 = merge(HUMAN, '2026-07-10T03:00:00Z', 'feature-b', 'Merge pull request #2');

  git(['checkout', '--quiet', '-b', 'feature-c']);
  write('src/feature-c.ts', 'export const c = 1;\n');
  const fc1 = commit(CLAUDE, '2026-07-11T05:00:00Z', 'feat(c): later work');

  git(['checkout', '--quiet', '-b', 'stale-branch', c1]);
  write('src/stale.ts', 'export const s = 1;\n');
  const b1 = commit(CLAUDE, '2026-07-12T00:00:00Z', 'feat(stale): built from an old commit');

  git(['checkout', '--quiet', 'main']);
  // The ledger reads main as `origin/main`, the way a fresh clone names it.
  git(['update-ref', 'refs/remotes/origin/main', 'main']);

  return { dir, c1, c2, c3, a1, aMerge, a2, m1, c4, c5, fb1, m2, fc1, b1 };
}
