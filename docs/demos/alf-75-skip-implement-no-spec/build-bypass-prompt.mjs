// Builds the "Skip to Development" (bypass) deep link from the REAL link builder and prints the
// parts ALF-75 changed: the prompt no longer names a spec-path in the alfred block and no longer
// points at the implement-spec skill, while keeping phase: implementation and the ask-first gate.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { buildBypassUrl } = await import(resolve(here, '../../../frontend/lib/code/links.ts'));

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const story = { ref: 'ALF-4', title: 'Tweak the digest send time', notes: null, spec_path: null };

const prompt = new URL(buildBypassUrl(project, story)).searchParams.get('q') ?? '';

console.log('phase implementation :', prompt.includes('phase: implementation'));
console.log('spec-path line       :', /spec-path:/i.test(prompt));
console.log('reads implement skill:', prompt.includes('.claude/skills/implement-spec/SKILL.md'));
console.log('asks for spec         :', /read the (committed |merged )?spec|merged spec/i.test(prompt));
console.log('keeps ask-first gate :', /ask me here/i.test(prompt));
console.log('keeps TDD nudge       :', /tests\/TDD/i.test(prompt));
console.log('--- alfred block ---');
console.log(prompt.slice(prompt.indexOf('```alfred'), prompt.indexOf('```', prompt.indexOf('```alfred') + 3) + 3));
