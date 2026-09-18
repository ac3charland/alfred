// Builds each SDLC launch prompt from the REAL link builders and prints the one new line every
// one of them now carries: the no-scheduled-check-ins guardrail, duplicated verbatim into the
// prompt itself (not just left in CLAUDE.md/the skills) so it reaches the agent even after it has
// stopped reading further files.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const links = await import(resolve(here, '../../../frontend/lib/code/links.ts'));

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const story = {
  ref: 'ALF-42',
  title: 'Verify the GitHub webhook HMAC signature',
  notes: null,
  epic_spec_path: null,
  spec_path: 'docs/specs/ALF-42.html',
};
const epic = { ref: 'ALF-12', name: 'Communication Firewall', notes: null, spec_path: null };

const guardrailLine = (prompt) =>
  prompt.split('\n').find((line) => /proactively schedule a check-in/i.test(line)) ?? '(missing)';

const promptOf = (url) => new URL(url).searchParams.get('q') ?? '';

const storyBuilders = [
  ['buildRefinementUrl', links.buildRefinementUrl],
  ['buildSpikeUrl', links.buildSpikeUrl],
  ['buildBugUrl', links.buildBugUrl],
  ['buildImplementationUrl', links.buildImplementationUrl],
  ['buildBypassUrl', links.buildBypassUrl],
];
const epicBuilders = [
  ['buildEpicRefinementUrl', links.buildEpicRefinementUrl],
  ['buildEpicImplementationUrl', links.buildEpicImplementationUrl],
];

const lines = [
  ...storyBuilders.map(([name, build]) => [name, guardrailLine(promptOf(build(project, story)))]),
  ...epicBuilders.map(([name, build]) => [name, guardrailLine(promptOf(build(project, epic)))]),
];

for (const [name, line] of lines) {
  console.log(`${name}:`);
  console.log(`  ${line}`);
}

const distinctLines = new Set(lines.map(([, line]) => line));
console.log();
console.log(
  distinctLines.size === 1
    ? '=== all seven prompts carry the identical guardrail line ==='
    : `=== MISMATCH: ${distinctLines.size} distinct lines across the seven prompts ===`,
);
