// Builds every launch prompt from the REAL link builders and prints the adversarial-review step
// each carries: the three code lanes (implementation, skip-refinement, bug) carry the identical
// step, and the document lanes plus the epic lanes carry none.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const links = await import(resolve(here, '../../../frontend/lib/code/links.ts'));

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const story = {
  ref: 'ALF-42',
  title: 'Verify the GitHub webhook HMAC signature',
  notes: 'Two review rounds, please.',
  epic_spec_path: null,
  spec_path: 'docs/specs/ALF-42.html',
};
const bug = { ...story, title: 'Bug: the capture box keeps its draft after submit' };
const epic = { ref: 'ALF-12', name: 'Communication Firewall', notes: null, spec_path: null };

const promptOf = (url) => new URL(url).searchParams.get('q') ?? '';
const reviewLine = (prompt) =>
  prompt.split('\n').find((line) => /adversarial review/i.test(line)) ?? '(none)';

const lanes = [
  ['buildImplementationUrl', promptOf(links.buildImplementationUrl(project, story))],
  ['buildBypassUrl', promptOf(links.buildBypassUrl(project, { ...story, spec_path: null }))],
  ['buildBugUrl', promptOf(links.buildBugUrl(project, bug))],
  ['buildRefinementUrl', promptOf(links.buildRefinementUrl(project, story))],
  ['buildSpikeUrl', promptOf(links.buildSpikeUrl(project, story))],
  ['buildEpicRefinementUrl', promptOf(links.buildEpicRefinementUrl(project, epic))],
  ['buildEpicImplementationUrl', promptOf(links.buildEpicImplementationUrl(project, epic))],
];

for (const [name, prompt] of lanes) {
  console.log(`${name}:`);
  console.log(`  ${reviewLine(prompt)}`);
}

// The skip-refinement prompt in full, so the step's place — after the PR opens, before the
// check-in guardrail and the ticket notes that may override it — is visible in context.
console.log();
console.log('=== the skip-refinement prompt, end to end ===');
console.log(lanes[1][1]);
