// Runs the copy-ready `alfred-frontmatter` CI check — lifted verbatim from the `node -e` block in
// docs/code-module/repo-setup/alfred-frontmatter.yml — against the one-shot PR's block, to show the
// check now accepts `phase: epic-implementation`, asks it for no `spec-path` (only the refinement
// phases and a spike need one), and never asks for the epic spec to be archived.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const workflow = readFileSync(
  resolve(repoRoot, 'docs/code-module/repo-setup/alfred-frontmatter.yml'),
  'utf8',
);

// Lift the script the workflow runs: everything between `node -e '` and the closing quote.
const script = workflow.slice(
  workflow.indexOf("node -e '") + "node -e '".length,
  workflow.lastIndexOf("'"),
);

// The archive rule tests `fs.existsSync(spec-path)`, so run against a throwaway fixture tree
// holding an epic spec and one un-archived story spec.
const fixture = mkdtempSync(join(tmpdir(), 'alfred-frontmatter-'));
mkdirSync(join(fixture, 'docs/specs/epics'), { recursive: true });
writeFileSync(join(fixture, 'docs/specs/ALF-42.html'), '<!doctype html>');
writeFileSync(join(fixture, 'docs/specs/epics/ALF-12.html'), '<!doctype html>');

const block = (lines) => ['```alfred', ...lines, '```'].join('\n');

const cases = [
  ['the epic one-shot PR', ['alfred-ticket: ALF-12', 'phase: epic-implementation']],
  [
    'a story implementation PR (unchanged)',
    ['alfred-ticket: ALF-42', 'phase: implementation', 'spec-path: docs/specs/archive/ALF-42.html'],
  ],
  [
    'a story implementation PR leaving its spec un-archived',
    ['alfred-ticket: ALF-42', 'phase: implementation', 'spec-path: docs/specs/ALF-42.html'],
  ],
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
    outcome = `PASS — ${stdout.trim()}`;
  } catch (error) {
    outcome = `FAIL — ${String(error.stderr).trim()}`;
  }
  console.log(`${label.padEnd(46)} ${outcome}`);
}
