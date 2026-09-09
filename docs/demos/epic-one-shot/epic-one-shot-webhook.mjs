// What the webhook Worker does with the one-shot PR's block, straight from the real parser and
// transition table: `epic-implementation` parses as its own phase (it ENDS with `implementation`,
// so alternation order decides), and every action is an explicit no-op — an epic carries no
// lifecycle state and no implementation-PR column. The story rows are printed alongside to show
// what an epic ref would have triggered under `phase: implementation`.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { planTransition } = await import(resolve(here, '../../../workers/src/transitions.ts'));
const { parseFrontmatter } = await import(resolve(here, '../../../workers/src/frontmatter.ts'));

const body = ['```alfred', 'alfred-ticket: ALF-12', 'phase: epic-implementation', '```'].join('\n');
console.log('parsed PR block :', JSON.stringify(parseFrontmatter(body)));
console.log();

const events = [
  ['epic-implementation', 'opened', false],
  ['epic-implementation', 'closed', true],
  ['epic-implementation', 'closed', false],
  ['implementation', 'opened', false],
  ['implementation', 'closed', true],
];

for (const [phase, action, merged] of events) {
  const plan = planTransition({
    phase,
    action,
    merged,
    prUrl: 'https://github.com/ac3charland/alfred/pull/217',
    specPath: undefined,
  });
  const label = `${phase} + ${action}${action === 'closed' ? (merged ? ' & merged' : ' & NOT merged') : ''}`;
  console.log(label.padEnd(40), plan === undefined ? '→ no-op' : `→ ${JSON.stringify(plan)}`);
}
