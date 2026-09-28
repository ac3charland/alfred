import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { lintSkills } from './lint.ts';
import { rules } from './rules.ts';
import { parseLibrary, parseSkill, resolveSkillMdPaths } from './skill.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'skill-lint-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSkill(
  name: string,
  options: { frontmatter: string; body: string; dirs?: string[] },
): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const resource of options.dirs ?? [])
    mkdirSync(path.join(dir, resource), { recursive: true });
  const skillMdPath = path.join(dir, 'SKILL.md');
  writeFileSync(skillMdPath, `---\n${options.frontmatter}\n---\n${options.body}`);
  return skillMdPath;
}

function writeAsset(skill: string, file: string, lines: string[]): void {
  const asset = path.join(root, skill, 'assets', file);
  mkdirSync(path.dirname(asset), { recursive: true });
  writeFileSync(asset, lines.join('\n'));
}

function skill(name: string): string {
  return writeSkill(name, {
    frontmatter: `name: ${path.basename(name)}\ndescription: x`,
    body: '# X\n',
  });
}

function parseNamed(skill: string): ReturnType<typeof parseSkill> {
  return parseSkill(
    writeSkill(skill, { frontmatter: `name: ${skill}\ndescription: x`, body: '# X\n' }),
    root,
  );
}

describe('parseSkill', () => {
  it('reads an inline description and the frontmatter name', () => {
    const skillMdPath = writeSkill('inline', {
      frontmatter: 'name: inline\ndescription: A one-line description.',
      body: '# Inline\n',
    });
    const skill = parseSkill(skillMdPath, root);
    expect(skill.name).toBe('inline');
    expect(skill.description).toBe('A one-line description.');
  });

  it('folds a block-scalar description to a single line', () => {
    const skillMdPath = writeSkill('folded', {
      frontmatter: 'name: folded\ndescription: >\n  First part of the text\n  and the second part.',
      body: '# Folded\n',
    });
    const skill = parseSkill(skillMdPath, root);
    expect(skill.description).toBe('First part of the text and the second part.');
    expect(skill.description).not.toContain('\n');
  });

  it('detects bundled resource directories as compound', () => {
    const skillMdPath = writeSkill('compound', {
      frontmatter: 'name: compound\ndescription: x',
      body: '# Compound\n',
      dirs: ['references', 'scripts'],
    });
    const skill = parseSkill(skillMdPath, root);
    expect(skill.isCompound).toBe(true);
    expect(skill.resourceDirs).toEqual(['references', 'scripts']);
  });

  it('ignores headings inside code fences', () => {
    const body = [
      '# Title',
      '',
      '## Real Heading',
      '',
      '```bash',
      '# not a heading',
      '## also not a heading',
      '```',
      '',
      '## Another',
      '',
    ].join('\n');
    const skillMdPath = writeSkill('fences', {
      frontmatter: 'name: fences\ndescription: x',
      body,
    });
    const skill = parseSkill(skillMdPath, root);
    expect(
      skill.headings.filter((heading) => heading.level === 2).map((heading) => heading.text),
    ).toEqual(['Real Heading', 'Another']);
  });

  describe('house stylesheets', () => {
    const shared = ['   TEMPLATE · 1 · TOKENS */', ':root{--ink:#13203a}', ''];

    it('reads the copy from the TEMPLATE · 1 line up to section 4, with its asset and line', () => {
      writeAsset('refinement', 'spec.html', [
        '<style>',
        '/* ═══',
        ...shared,
        '/* ═══ TEMPLATE · 4 · PLATE ═══ */',
        '.app{}',
        '</style>',
      ]);
      expect(parseNamed('refinement').houseStylesheets).toEqual([
        { asset: 'refinement/assets/spec.html', line: 3, css: shared.join('\n').trimEnd() },
      ]);
    });

    it('ends a copy with no section 4 at </style>, so it matches one that has it', () => {
      writeAsset('refinement', 'spec.html', [
        '<style>',
        ...shared,
        '/* ═══ TEMPLATE · 4 ═══ */',
        '</style>',
      ]);
      writeAsset('spike', 'findings.html', ['<style>', ...shared, '</style>']);
      const [spike] = parseNamed('spike').houseStylesheets;
      expect(spike?.css).toBe(shared.join('\n').trimEnd());
      expect(parseNamed('refinement').houseStylesheets[0]?.css).toBe(spike?.css);
    });

    it('runs a copy with no end marker to the end of the file', () => {
      writeAsset('spike', 'findings.html', ['<style>', ...shared]);
      expect(parseNamed('spike').houseStylesheets[0]?.css).toBe(shared.join('\n').trimEnd());
    });

    it('starts at the <style> tag, past a guide comment that mentions both it and the marker', () => {
      writeAsset('spike', 'findings.html', [
        '<!-- guide: the <style> block below',
        '     keeps TEMPLATE · 1–3 verbatim -->',
        '<style>',
        ...shared,
        '</style>',
      ]);
      expect(parseNamed('spike').houseStylesheets[0]?.line).toBe(4);
    });

    it('reads assets in nested folders and skips a folder named like a page', () => {
      writeAsset('spike', 'nested/findings.html', ['<style>', ...shared, '</style>']);
      mkdirSync(path.join(root, 'spike', 'assets', 'folder.html'));
      expect(parseNamed('spike').houseStylesheets.map((copy) => copy.asset)).toEqual([
        'spike/assets/nested/findings.html',
      ]);
    });

    it('flags a style block that has section markers but lost its TEMPLATE · 1 line', () => {
      writeAsset('spike', 'findings.html', [
        '<style>',
        '   TEMPLATE · I · TOKENS */',
        ':root{--ink:#13203a}',
        '/* ═══ TEMPLATE · 2 · PAGE ═══ */',
        '</style>',
      ]);
      expect(parseNamed('spike').houseStylesheets).toEqual([
        { asset: 'spike/assets/findings.html', line: 2, css: undefined },
      ]);
    });

    it.each([
      ['a style block without the house stylesheet', ['<style>', 'body{}', '</style>']],
      ['markers outside any style block', ['<!-- TEMPLATE · 1 -->', '<p>TEMPLATE · 2</p>']],
    ])('carries none for %s', (_label, lines) => {
      writeAsset('plain', 'page.html', lines);
      expect(parseNamed('plain').houseStylesheets).toEqual([]);
    });
  });

  it('counts body lines without trailing blanks', () => {
    const skillMdPath = writeSkill('lines', {
      frontmatter: 'name: lines\ndescription: x',
      body: 'one\ntwo\nthree\n\n\n',
    });
    expect(parseSkill(skillMdPath, root).bodyLineCount).toBe(3);
  });
});

describe('resolveSkillMdPaths', () => {
  it('expands a directory of skills to each child SKILL.md', () => {
    const a = writeSkill('a', { frontmatter: 'name: a\ndescription: x', body: '# A\n' });
    const b = writeSkill('b', { frontmatter: 'name: b\ndescription: x', body: '# B\n' });
    // `a` sorts before `b`, so the expected list is already in lexical order.
    expect(resolveSkillMdPaths([], root, root)).toEqual([a, b]);
  });

  it('expands a glob', () => {
    const a = writeSkill('a', { frontmatter: 'name: a\ndescription: x', body: '# A\n' });
    const b = writeSkill('b', { frontmatter: 'name: b\ndescription: x', body: '# B\n' });
    expect(resolveSkillMdPaths(['*/SKILL.md'], root, root)).toEqual([a, b]);
  });

  it('resolves a single skill directory to its SKILL.md', () => {
    const a = writeSkill('a', { frontmatter: 'name: a\ndescription: x', body: '# A\n' });
    expect(resolveSkillMdPaths(['a'], root, root)).toEqual([a]);
  });
});

describe('parseLibrary', () => {
  it('parses the linted skills, and the library adds only their unlinted siblings', () => {
    const a = skill('library/a');
    skill('library/b');
    skill('elsewhere/c');
    const { skills, library } = parseLibrary([a], root);
    expect(skills.map((parsed) => parsed.name)).toEqual(['a']);
    expect(library.map((parsed) => parsed.name)).toEqual(['a', 'b']);
  });

  it('lets an unlinted sibling’s copy catch a drifted one, as the changed-only gate needs', () => {
    const refinement = skill('library/refinement');
    skill('library/spike');
    writeAsset('library/refinement', 'spec.html', [
      '<style>',
      '   TEMPLATE · 1 */',
      'a{}',
      '</style>',
    ]);
    writeAsset('library/spike', 'findings.html', [
      '<style>',
      '   TEMPLATE · 1 */',
      'b{}',
      '</style>',
    ]);
    const { skills, library } = parseLibrary([refinement], root);
    const [report] = lintSkills(skills, rules, library);
    const drift = report?.findings.filter((finding) => finding.rule === 'house-stylesheet');
    expect(drift?.map((finding) => finding.message)).toEqual([
      expect.stringContaining('refinement/assets/spec.html:3'),
    ]);
  });
});
