// Runs the copy-ready `alfred-frontmatter` CI check — lifted verbatim from the `node -e` block in
// docs/code-module/repo-setup/alfred-frontmatter.yml — against four PR bodies, to show it now
// accepts `phase: epic-refinement`, still requires `spec-path` on it, and never asks for an epic
// spec (docs/specs/epics/…) to be archived.
//
// The archive rule tests `fs.existsSync(spec-path)`, so the cases run against a throwaway fixture
// tree holding one un-archived story spec and one epic spec — not this repo's own docs/specs,
// whose contents change with every merge.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const workflow = readFileSync(resolve(repoRoot, 'docs/code-module/repo-setup/alfred-frontmatter.yml'), 'utf8');

// Lift the script the workflow runs: everything between `node -e '` and the closing quote.
const script = workflow.slice(workflow.indexOf("node -e '") + "node -e '".length, workflow.lastIndexOf("'"));

const fixture = mkdtempSync(join(tmpdir(), 'alfred-frontmatter-'));
mkdirSync(join(fixture, 'docs/specs/epics'), { recursive: true });
writeFileSync(join(fixture, 'docs/specs/ALF-42.html'), '<!doctype html>');
writeFileSync(join(fixture, 'docs/specs/epics/ALF-12.html'), '<!doctype html>');

const block = (lines) => ['```alfred', ...lines, '```'].join('\n');

const cases = [
  ['epic-refinement with a spec-path', ['alfred-ticket: ALF-12', 'phase: epic-refinement', 'spec-path: docs/specs/epics/ALF-12.html']],
  ['epic-refinement MISSING spec-path', ['alfred-ticket: ALF-12', 'phase: epic-refinement']],
  ['implementation pointing at an epic spec (never archived)', ['alfred-ticket: ALF-99', 'phase: implementation', 'spec-path: docs/specs/epics/ALF-12.html']],
  ['implementation leaving its STORY spec un-archived', ['alfred-ticket: ALF-42', 'phase: implementation', 'spec-path: docs/specs/ALF-42.html']],
];

for (const [label, lines] of cases) {
  let outcome;
  try {
    const stdout = execFileSync('node', ['-e', script], {
      env: { ...process.env, BODY: block(lines) },
      cwd: fixture,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    outcome = `PASS  ${stdout.trim()}`;
  } catch (error) {
    outcome = `FAIL  ${String(error.stderr).trim()}`;
  }
  console.log(label.padEnd(56), outcome);
}
