import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseSkill, resolveSkillMdPaths, siblingSkillMdPaths } from './skill.ts';

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
  const assets = path.join(root, skill, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(path.join(assets, file), lines.join('\n'));
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

    it('starts inside <style>, past a guide comment that mentions the marker', () => {
      writeAsset('spike', 'findings.html', [
        '<!-- guide: keep TEMPLATE · 1–3 verbatim -->',
        '<style>',
        ...shared,
        '</style>',
      ]);
      expect(parseNamed('spike').houseStylesheets[0]?.line).toBe(3);
    });

    it('carries none for assets without the house stylesheet', () => {
      writeAsset('plain', 'page.html', ['<style>', 'body{}', '</style>']);
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

  it('finds the unlinted skills beside each linted one, and only those', () => {
    const a = writeSkill('library/a', { frontmatter: 'name: a\ndescription: x', body: '# A\n' });
    const b = writeSkill('library/b', { frontmatter: 'name: b\ndescription: x', body: '# B\n' });
    writeSkill('elsewhere/c', { frontmatter: 'name: c\ndescription: x', body: '# C\n' });
    expect(siblingSkillMdPaths([a], root)).toEqual([b]);
  });

  it('resolves a single skill directory to its SKILL.md', () => {
    const a = writeSkill('a', { frontmatter: 'name: a\ndescription: x', body: '# A\n' });
    expect(resolveSkillMdPaths(['a'], root, root)).toEqual([a]);
  });
});
