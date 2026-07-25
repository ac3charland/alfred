// Builds the "Refine epic in Claude Code" deep link from the REAL link builder and prints the
// prompt it prefills — first for an epic that has never been refined, then for one that already
// carries a spec (where the prompt must say to update that file in place rather than add a second).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { buildEpicRefinementUrl } = await import(resolve(here, '../../../frontend/lib/code/links.ts'));

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const epic = {
  ref: 'ALF-12',
  name: 'Communication Firewall',
  notes: 'Everything about how alfred talks to me: notifications, Siri capture, the morning brief.',
  spec_path: null,
};

const promptFor = (overrides) =>
  new URL(buildEpicRefinementUrl(project, { ...epic, ...overrides })).searchParams.get('q') ?? '';

console.log('=== A never-refined epic ===');
console.log(promptFor({}));

const refined = promptFor({ spec_path: 'docs/specs/epics/ALF-12.html' });
console.log();
console.log('=== The same epic, already carrying a spec (only step 3 differs) ===');
console.log(refined.split('\n').find((line) => line.startsWith('3. ')));
