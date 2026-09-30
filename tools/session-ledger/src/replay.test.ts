import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildFixtureRepo } from './fixture-repo.ts';
import type { FixtureRepo } from './fixture-repo.ts';
import { GitHistory, gitIn } from './git.ts';
import { BuilderLoader, launchTimeSubject, promptFromUrl, skillPathsIn } from './replay.ts';

let repo: FixtureRepo;
let tmp: string;
let loader: BuilderLoader;

const PROJECT = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const STORY = {
  ref: 'ALF-9',
  title: 'A fixture story',
  notes: 'Invented notes.',
  spec_path: 'docs/specs/ALF-9.html',
  spec_sha: null,
  epic_spec_path: null,
};

beforeAll(() => {
  repo = buildFixtureRepo(mkdtempSync(path.join(os.tmpdir(), 'ledger-replay-')));
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ledger-replay-modules-'));
  loader = new BuilderLoader(new GitHistory(gitIn(repo.dir)), tmp);
});

afterAll(() => {
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

describe('BuilderLoader.replay', () => {
  it('rebuilds each version’s own prompt, reading both the prompt= and the q= URL forms', async () => {
    const v1 = await loader.replay(repo.c1, 'buildImplementationUrl', PROJECT, STORY);
    const v2 = await loader.replay(repo.c4, 'buildImplementationUrl', PROJECT, STORY);

    expect(v1).toEqual({
      prompt: [
        'ALF-9: A fixture story',
        'Implement the spec at `docs/specs/ALF-9.html`, following `.claude/skills/implement-spec/SKILL.md` where present.',
        'Invented notes.',
      ].join('\n'),
    });
    expect('prompt' in v2 && v2.prompt).toContain('.claude/skills/adversarial-review/SKILL.md');
    expect('prompt' in v2 && v2.prompt).not.toBe('prompt' in v1 && v1.prompt);
  });

  it('warns builder_missing when the export did not exist at that sha', async () => {
    expect(await loader.replay(repo.c1, 'buildBypassUrl', PROJECT, STORY)).toEqual({
      warning: 'builder_missing',
    });
    expect(await loader.has(repo.c1, 'buildBugUrl')).toBe(false);
    expect(await loader.has(repo.c4, 'buildBugUrl')).toBe(true);
  });

  it('warns builder_threw when the builder throws', async () => {
    const story = { ...STORY, notes: 'this one should explode' };
    expect(await loader.replay(repo.c4, 'buildBugUrl', PROJECT, story)).toEqual({
      warning: 'builder_threw',
    });
  });

  it('warns builder_missing when the builder file did not exist at all', async () => {
    expect(await loader.replay(null, 'buildImplementationUrl', PROJECT, STORY)).toEqual({
      warning: 'builder_missing',
    });
  });
});

describe('promptFromUrl', () => {
  it('prefers q, falls back to prompt, and is null for neither', () => {
    expect(promptFromUrl('https://claude.ai/code?q=a&prompt=b')).toBe('a');
    expect(promptFromUrl('https://claude.ai/code?prompt=b')).toBe('b');
    expect(promptFromUrl('https://claude.ai/code?repo=x')).toBeNull();
  });
});

describe('skillPathsIn', () => {
  it('lists each distinct skill path in order of first appearance', () => {
    const prompt =
      'read `.claude/skills/implement-spec/SKILL.md`, then .claude/skills/adversarial-review/SKILL.md, ' +
      'then .claude/skills/implement-spec/SKILL.md again; not .claude/skills/Bad/SKILL.md';
    expect(skillPathsIn(prompt)).toEqual([
      '.claude/skills/implement-spec/SKILL.md',
      '.claude/skills/adversarial-review/SKILL.md',
    ]);
  });
});

/** At base, only the ALF-9 spec exists. */
function exists(file: string): boolean {
  return file === 'docs/specs/ALF-9.html';
}

describe('launchTimeSubject', () => {
  it('nulls every spec-path field whose file was absent at base', () => {
    const story = {
      ...STORY,
      spec_path: 'docs/specs/later.html',
      epic_spec_path: 'docs/epics/x.html',
    };
    expect(launchTimeSubject('refinement', story, undefined, exists)).toEqual({
      ...story,
      spec_path: null,
      epic_spec_path: null,
    });
  });

  it('keeps a spec path whose file was there', () => {
    expect(launchTimeSubject('refinement', STORY, undefined, exists)).toEqual(STORY);
  });

  it('always hands the implementation lane its block’s spec-path, present or not', () => {
    const subject = launchTimeSubject(
      'implementation',
      { ...STORY, spec_path: null },
      'docs/specs/gone.html',
      exists,
    );
    expect(subject.spec_path).toBe('docs/specs/gone.html');
  });

  it('nulls an epic’s spec path the same way', () => {
    const epic = { ref: 'ALF-4', name: 'Epic', spec_path: 'docs/epics/ALF-4.html', spec_sha: null };
    expect(launchTimeSubject('epic-implementation', epic, undefined, exists).spec_path).toBeNull();
  });

  it('does not mutate the input', () => {
    const story = { ...STORY, spec_path: 'docs/specs/later.html' };
    launchTimeSubject('refinement', story, undefined, exists);
    expect(story.spec_path).toBe('docs/specs/later.html');
  });
});
