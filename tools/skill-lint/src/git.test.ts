import { changedSkillNames, selectChangedSkills } from './git.ts';

describe('changedSkillNames', () => {
  it('maps changed paths to the skills that own them', () => {
    const names = changedSkillNames([
      '.claude/skills/backpressure/SKILL.md',
      '.claude/skills/showboat/references/recipes.md',
      'frontend/lib/tree.ts',
      '.claude/skills/README.md',
    ]);
    expect(names).toEqual(new Set(['backpressure', 'showboat']));
  });

  it('passes through an unknown diff as undefined (lint everything)', () => {
    expect(changedSkillNames()).toBeUndefined();
  });

  it('returns an empty set when nothing under a skill changed', () => {
    expect(changedSkillNames(['frontend/app/page.tsx'])).toEqual(new Set());
  });
});

describe('selectChangedSkills', () => {
  const paths = [
    '/repo/.claude/skills/backpressure/SKILL.md',
    '/repo/.claude/skills/showboat/SKILL.md',
    '/repo/.claude/skills/git/SKILL.md',
  ];

  it('keeps only the SKILL.md files whose folder changed', () => {
    expect(selectChangedSkills(paths, new Set(['showboat', 'git']))).toEqual([
      '/repo/.claude/skills/showboat/SKILL.md',
      '/repo/.claude/skills/git/SKILL.md',
    ]);
  });

  it('lints everything when the change set is unknown', () => {
    expect(selectChangedSkills(paths)).toEqual(paths);
  });

  it('lints nothing when no skill changed', () => {
    expect(selectChangedSkills(paths, new Set())).toEqual([]);
  });
});
