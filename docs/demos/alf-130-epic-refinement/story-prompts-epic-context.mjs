// Every story launch prompt (refine / implement / skip-to-dev) picks up a paragraph pointing at
// the epic's spec when the story's epic has one — and says nothing at all when it doesn't.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const links = await import(resolve(here, '../../../frontend/lib/code/links.ts'));

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const story = {
  ref: 'ALF-42',
  title: 'Verify the GitHub webhook HMAC signature',
  notes: null,
  spec_path: 'docs/specs/ALF-42.html',
  epic_ref: 'ALF-12',
  epic_name: 'Communication Firewall',
  epic_spec_path: null,
};

const builders = {
  'Refine in Claude Code': links.buildRefinementUrl,
  'Implement in Claude Code': links.buildImplementationUrl,
  'Skip to Development': links.buildBypassUrl,
};

const promptFor = (build, epicSpecPath) =>
  new URL(build(project, { ...story, epic_spec_path: epicSpecPath })).searchParams.get('q') ?? '';

const epicLine = (prompt) => prompt.split('\n').find((line) => line.startsWith('Epic context:'));

for (const [label, build] of Object.entries(builders)) {
  console.log(`--- ${label} ---`);
  console.log('epic HAS a spec  :', epicLine(promptFor(build, 'docs/specs/epics/ALF-12.html')));
  console.log('epic has NO spec :', epicLine(promptFor(build, null)) ?? '(no epic-context paragraph)');
}
