// Builds the "Implement epic in Claude Code" deep link from the REAL link builder and prints the
// prompt it prefills — first for the epic the launch is offered from (one carrying a committed
// epic spec), then for a spec-less epic, where the prompt must NOT name a file nobody wrote.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { buildEpicImplementationUrl } = await import(
  resolve(here, '../../../frontend/lib/code/links.ts')
);

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const epic = {
  ref: 'ALF-12',
  name: 'Communication Firewall',
  notes: 'Everything about how alfred talks to me: notifications, Siri capture, the morning brief.',
  spec_path: 'docs/specs/epics/ALF-12.html',
};

const promptFor = (overrides) =>
  new URL(buildEpicImplementationUrl(project, { ...epic, ...overrides })).searchParams.get('q') ??
  '';

console.log('=== An epic carrying a committed spec (the only case the menu offers) ===');
console.log(promptFor({}));

console.log();
console.log('=== A spec-less epic: step 2 names no file, it routes back to the human ===');
console.log(
  promptFor({ spec_path: null })
    .split('\n')
    .find((line) => line.startsWith('2. ')),
);
