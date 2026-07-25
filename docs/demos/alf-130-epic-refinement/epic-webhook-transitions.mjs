// The webhook Worker's decision for an epic-refinement PR, straight from the real transition
// table: it targets the `epics` row (never `code_items`), records the PR url on open and the
// spec path on merge, and NO-OPS on close-without-merge — an epic has no state to revert. The
// existing story rows are printed alongside to show they still target the story.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { planTransition } = await import(resolve(here, '../../../workers/src/transitions.ts'));
const { parseFrontmatter } = await import(resolve(here, '../../../workers/src/frontmatter.ts'));

const body = ['```alfred', 'alfred-ticket: ALF-12', 'phase: epic-refinement', 'spec-path: docs/specs/epics/ALF-12.html', '```'].join('\n');
const parsed = parseFrontmatter(body);
console.log('parsed PR block :', JSON.stringify(parsed));
console.log();

const events = [
  ['epic-refinement', 'opened', false],
  ['epic-refinement', 'closed', true],
  ['epic-refinement', 'closed', false],
  ['refinement', 'closed', true],
  ['implementation', 'opened', false],
];

for (const [phase, action, merged] of events) {
  const plan = planTransition({
    phase,
    action,
    merged,
    prUrl: 'https://github.com/ac3charland/alfred/pull/12',
    specPath: phase === 'implementation' ? undefined : 'docs/specs/epics/ALF-12.html',
  });
  const label = `${phase} + ${action}${action === 'closed' ? (merged ? ' & merged' : ' & NOT merged') : ''}`;
  console.log(label.padEnd(38), plan === undefined ? '→ no-op' : `→ ${JSON.stringify(plan)}`);
}
