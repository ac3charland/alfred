import type { Project } from '@/lib/types';

import { parseProjectPrefix } from './project-prefix';

function makeProject(overrides: Partial<Project> & Pick<Project, 'id' | 'name' | 'key'>): Project {
  return {
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const alfred = makeProject({ id: 'p-alf', name: 'Alfred', key: 'ALF' });
const projects = [alfred];

describe('parseProjectPrefix', () => {
  it('matches on the project key (case-insensitive) and cleans the title', () => {
    expect(parseProjectPrefix('ALF: add dark mode', projects)).toEqual({
      project: alfred,
      title: 'Add dark mode',
    });
    expect(parseProjectPrefix('alf: add dark mode', projects)).toEqual({
      project: alfred,
      title: 'Add dark mode',
    });
  });

  it('matches on the project name (case-insensitive)', () => {
    expect(parseProjectPrefix('Alfred: add dark mode', projects)?.project).toBe(alfred);
    expect(parseProjectPrefix('alfred: add dark mode', projects)?.project).toBe(alfred);
    expect(parseProjectPrefix('ALFRED: add dark mode', projects)?.title).toBe('Add dark mode');
  });

  it('matches with no space after the colon', () => {
    expect(parseProjectPrefix('alf:fix bug', projects)).toEqual({
      project: alfred,
      title: 'Fix bug',
    });
  });

  it('splits only on the first colon, keeping later colons in the title', () => {
    expect(parseProjectPrefix('ALF: rename the : separator', projects)?.title).toBe(
      'Rename the : separator',
    );
  });

  it('capitalizes only the first letter, leaving the rest as typed', () => {
    expect(parseProjectPrefix('ALF: fix the BUG in DarkMode', projects)?.title).toBe(
      'Fix the BUG in DarkMode',
    );
  });

  it('leaves a remainder that starts with a non-letter unchanged', () => {
    expect(parseProjectPrefix('ALF: 3 bugs to fix', projects)?.title).toBe('3 bugs to fix');
  });

  it('trims surrounding whitespace on both the prefix and the remainder', () => {
    expect(parseProjectPrefix('  ALF  :   add dark mode  ', projects)).toEqual({
      project: alfred,
      title: 'Add dark mode',
    });
  });

  it('returns null when there is no colon', () => {
    expect(parseProjectPrefix('buy milk', projects)).toBeNull();
  });

  it('returns null for an unrecognized prefix', () => {
    expect(parseProjectPrefix('Note: buy milk', projects)).toBeNull();
  });

  it('returns null when the remainder is empty', () => {
    expect(parseProjectPrefix('ALF:', projects)).toBeNull();
    expect(parseProjectPrefix('ALF:   ', projects)).toBeNull();
  });

  it('returns null when the prefix (before the colon) is empty', () => {
    expect(parseProjectPrefix(': add dark mode', projects)).toBeNull();
  });

  it('prefers a key match over a name match', () => {
    // A second project NAMED "ALF" must not shadow the project whose KEY is ALF.
    const decoy = makeProject({ id: 'p-decoy', name: 'ALF', key: 'DEC' });
    const match = parseProjectPrefix('ALF: ship it', [decoy, alfred]);
    expect(match?.project).toBe(alfred);
  });

  it('returns null for an ambiguous (duplicate) name match', () => {
    const one = makeProject({ id: 'p1', name: 'Platform', key: 'PL1' });
    const two = makeProject({ id: 'p2', name: 'Platform', key: 'PL2' });
    expect(parseProjectPrefix('Platform: do the thing', [one, two])).toBeNull();
  });

  it('returns null when the project list is empty', () => {
    expect(parseProjectPrefix('ALF: add dark mode', [])).toBeNull();
  });
});
