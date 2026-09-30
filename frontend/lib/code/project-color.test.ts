import type { Project } from '@/lib/types';

import {
  PROJECT_COLORS,
  isProjectColor,
  projectBadgeClasses,
  projectColorAt,
  projectColorFor,
  projectFillClasses,
  projectSlotColorFor,
  projectTextClasses,
  projectTitleClasses,
} from './project-color';

function makeProject(id: string, color: string | null = null): Project {
  return {
    color,
    description: null,
    exclude_from_pr_ratio: false,
    id,
    name: id,
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  };
}

describe('projectColorAt', () => {
  it('assigns the palette in order from the first project', () => {
    expect(projectColorAt(0)).toBe('blue');
    expect(projectColorAt(1)).toBe('amber');
    expect(projectColorAt(2)).toBe('green');
    expect(projectColorAt(3)).toBe('red');
    expect(projectColorAt(4)).toBe('teal');
  });

  it('cycles back to the start once the palette is exhausted', () => {
    expect(projectColorAt(PROJECT_COLORS.length)).toBe('blue');
    expect(projectColorAt(PROJECT_COLORS.length + 1)).toBe('amber');
  });

  it('clamps a negative index to the first colour', () => {
    expect(projectColorAt(-1)).toBe('blue');
  });
});

describe('projectColorFor', () => {
  const projects = [makeProject('p1'), makeProject('p2'), makeProject('p3')];

  it('colours a project by its slot in the ordered list', () => {
    expect(projectColorFor(projects, 'p1')).toBe('blue');
    expect(projectColorFor(projects, 'p2')).toBe('amber');
    expect(projectColorFor(projects, 'p3')).toBe('green');
  });

  it('falls back to the first colour for an unknown id', () => {
    expect(projectColorFor(projects, 'missing')).toBe('blue');
    expect(projectColorFor(projects, null)).toBe('blue');
  });

  it("prefers the owner's stored pick over the creation slot", () => {
    const picked = [makeProject('p1'), makeProject('p2', 'teal'), makeProject('p3')];

    expect(projectColorFor(picked, 'p2')).toBe('teal');
    // The pick is the project's alone — its neighbours keep their slot colours.
    expect(projectColorFor(picked, 'p1')).toBe('blue');
    expect(projectColorFor(picked, 'p3')).toBe('green');
  });

  it('lets two projects share a colour — a pick never shifts another project', () => {
    const picked = [makeProject('p1', 'amber'), makeProject('p2')];

    expect(projectColorFor(picked, 'p1')).toBe('amber');
    expect(projectColorFor(picked, 'p2')).toBe('amber');
  });

  it('falls back to the slot colour for a stored value outside the palette', () => {
    const odd = [makeProject('p1'), makeProject('p2', 'violet')];

    expect(projectColorFor(odd, 'p2')).toBe('amber');
  });
});

describe('projectSlotColorFor', () => {
  it('names the creation-slot colour Automatic would return to, ignoring any pick', () => {
    const picked = [makeProject('p1'), makeProject('p2', 'teal')];

    expect(projectSlotColorFor(picked, 'p2')).toBe('amber');
    expect(projectSlotColorFor(picked, 'p1')).toBe('blue');
  });
});

describe('isProjectColor', () => {
  it.each(PROJECT_COLORS)('accepts the palette key %s', (color) => {
    expect(isProjectColor(color)).toBe(true);
  });

  it.each([null, undefined, '', 'violet', '#ff0000', 'Blue'])('rejects %p', (value) => {
    expect(isProjectColor(value)).toBe(false);
  });
});

describe('class helpers', () => {
  it('emits a tinted background and text class per colour', () => {
    expect(projectBadgeClasses('blue')).toBe('bg-accent-blue/15 text-accent-blue');
    expect(projectBadgeClasses('red')).toBe('bg-accent-red/15 text-accent-red');
    expect(projectBadgeClasses('teal')).toBe('bg-accent-teal/15 text-accent-teal');
  });

  it('emits a text-only class per colour for glyphs', () => {
    expect(projectTextClasses('amber')).toBe('text-accent-amber');
  });

  it.each([
    ['blue', 'text-accent-blue title-glow-blue'],
    ['amber', 'text-accent-amber title-glow-amber'],
    ['green', 'text-accent-green title-glow-green'],
    ['red', 'text-accent-red title-glow-red'],
    ['teal', 'text-accent-teal title-glow-teal'],
  ] as const)('emits the full glowing-title classes for %s', (color, classes) => {
    expect(projectTitleClasses(color)).toBe(classes);
  });

  it.each([
    ['blue', 'bg-accent-blue'],
    ['amber', 'bg-accent-amber'],
    ['green', 'bg-accent-green'],
    ['red', 'bg-accent-red'],
    ['teal', 'bg-accent-teal'],
  ] as const)('emits the full solid-fill class for %s', (color, fill) => {
    expect(projectFillClasses(color)).toBe(fill);
  });

  it('covers every palette colour with a solid fill', () => {
    expect(PROJECT_COLORS.map((color) => projectFillClasses(color))).toEqual(
      PROJECT_COLORS.map((color) => `bg-accent-${color}`),
    );
  });
});
