import type { Project } from '@/lib/types';

import {
  PROJECT_COLORS,
  projectBadgeClasses,
  projectColorAt,
  projectColorFor,
  projectTextClasses,
} from './project-color';

function makeProject(id: string): Project {
  return {
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
    expect(projectColorAt(3)).toBe('teal');
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
});

describe('class helpers', () => {
  it('emits a tinted background and text class per colour', () => {
    expect(projectBadgeClasses('blue')).toBe('bg-accent-blue/15 text-accent-blue');
    expect(projectBadgeClasses('teal')).toBe('bg-accent-teal/15 text-accent-teal');
  });

  it('emits a text-only class per colour for glyphs', () => {
    expect(projectTextClasses('amber')).toBe('text-accent-amber');
  });
});
