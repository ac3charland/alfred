import { countBySeverity, lintSkill, lintSkills } from './lint.ts';
import { BODY_MAX_LINES, DESCRIPTION_MAX_CHARS, rules } from './rules.ts';
import type { Heading, SkillContext } from './skill.ts';

function makeSkill(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    dir: '/skills/example',
    skillMdPath: '/skills/example/SKILL.md',
    displayPath: 'example/SKILL.md',
    name: 'example',
    description: 'A short, well-scoped description.',
    body: '# Example\n',
    bodyLineCount: 1,
    resourceDirs: [],
    isCompound: false,
    headings: [{ level: 1, text: 'Example', line: 1 }],
    ...overrides,
  };
}

function findingsFor(rule: string, skill: SkillContext): ReturnType<typeof lintSkill> {
  return lintSkill(skill).filter((finding) => finding.rule === rule);
}

function headings(...specs: [number, string][]): Heading[] {
  return specs.map(([level, text], index) => ({ level, text, line: index + 1 }));
}

describe('description-length', () => {
  it('passes a description at the cap', () => {
    const skill = makeSkill({ description: 'a'.repeat(DESCRIPTION_MAX_CHARS) });
    expect(findingsFor('description-length', skill)).toHaveLength(0);
  });

  it('errors one char over the cap', () => {
    const skill = makeSkill({ description: 'a'.repeat(DESCRIPTION_MAX_CHARS + 1) });
    const [finding] = findingsFor('description-length', skill);
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain(String(DESCRIPTION_MAX_CHARS + 1));
  });
});

describe('description-no-repo-name', () => {
  it('passes a description that names no repo', () => {
    const skill = makeSkill({ description: 'Covers the --workspaces fan-out in the monorepo.' });
    expect(findingsFor('description-no-repo-name', skill)).toHaveLength(0);
  });

  it.each([
    ['lowercase', "Documents alfred's check wiring."],
    ['capitalized', 'Documents Alfred check wiring.'],
  ])('errors when the description names the repo (%s)', (_label, description) => {
    const [finding] = findingsFor('description-no-repo-name', makeSkill({ description }));
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('names the repo');
  });
});

describe('body-length', () => {
  it('passes a body at the limit', () => {
    expect(findingsFor('body-length', makeSkill({ bodyLineCount: BODY_MAX_LINES }))).toHaveLength(
      0,
    );
  });

  it('warns (does not error) over the limit', () => {
    const [finding] = findingsFor('body-length', makeSkill({ bodyLineCount: BODY_MAX_LINES + 1 }));
    expect(finding?.severity).toBe('warn');
  });
});

describe('compound-toc', () => {
  it('ignores a non-compound skill with no TOC', () => {
    expect(findingsFor('compound-toc', makeSkill({ isCompound: false }))).toHaveLength(0);
  });

  it('errors when a compound skill has no TOC heading', () => {
    const skill = makeSkill({
      isCompound: true,
      resourceDirs: ['references'],
      headings: headings([1, 'Title'], [2, 'Mental Model']),
    });
    const [finding] = findingsFor('compound-toc', skill);
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('references/');
  });

  it.each([
    ['first H2', headings([1, 'Title'], [2, 'Contents'], [2, 'Body'])],
    ['second H2', headings([1, 'Title'], [2, 'Overview'], [2, 'Table of Contents'], [2, 'Body'])],
  ])('passes when the TOC is the %s', (_label, parsed) => {
    const skill = makeSkill({ isCompound: true, resourceDirs: ['references'], headings: parsed });
    expect(findingsFor('compound-toc', skill)).toHaveLength(0);
  });

  it('errors when the TOC is buried below the top sections', () => {
    const skill = makeSkill({
      isCompound: true,
      resourceDirs: ['scripts'],
      headings: headings([1, 'Title'], [2, 'A'], [2, 'B'], [2, 'Contents']),
    });
    const [finding] = findingsFor('compound-toc', skill);
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('near the top');
  });

  it('errors when the TOC is not a top-level section', () => {
    const skill = makeSkill({
      isCompound: true,
      resourceDirs: ['references'],
      headings: headings([1, 'Title'], [3, 'Contents'], [2, 'Body']),
    });
    expect(findingsFor('compound-toc', skill)).toHaveLength(1);
  });
});

describe('lint orchestration', () => {
  it('registers the rules', () => {
    expect(rules.map((rule) => rule.name)).toEqual([
      'description-length',
      'description-no-repo-name',
      'body-length',
      'compound-toc',
    ]);
  });

  it('tallies errors and warnings across skills', () => {
    const reports = lintSkills([
      makeSkill({ description: 'a'.repeat(DESCRIPTION_MAX_CHARS + 1) }),
      makeSkill({ bodyLineCount: BODY_MAX_LINES + 1 }),
    ]);
    expect(countBySeverity(reports)).toEqual({ errors: 1, warnings: 1 });
  });
});
