import {
  buildDestinations,
  destinationDomId,
  flattenDestinations,
} from '@/components/shell/command-destinations';
import type { Folder, Project } from '@/lib/types';

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'f1',
    name: 'A folder',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'A project',
    key: 'PRJ',
    created_at: '2025-01-01T00:00:00Z',
    github_url: null,
    ref_seq: 0,
    repo_name: 'repo',
    repo_owner: 'owner',
    ...overrides,
  };
}

describe('buildDestinations', () => {
  it('lists every destination for an empty / whitespace query, grouped in natural order', () => {
    const folders = [makeFolder({ id: 'fa', name: 'Software' })];
    const projects = [makeProject({ id: 'pa', name: 'Alfred', key: 'ALF' })];
    const grouped = buildDestinations(' '.repeat(3), folders, projects);

    expect(grouped.go.map((d) => d.label)).toEqual([
      'Tasks',
      'Inbox',
      'Priority',
      'Completed',
      'Code',
      'Backlog',
    ]);
    expect(grouped.folders.map((d) => d.label)).toEqual(['Software']);
    expect(grouped.projects.map((d) => d.label)).toEqual(['Alfred']);
  });

  it('emits correct hrefs for the static go-to destinations', () => {
    const grouped = buildDestinations('', [], []);
    const byLabel = Object.fromEntries(grouped.go.map((d) => [d.label, d.href]));
    expect(byLabel).toEqual({
      Tasks: '/',
      Inbox: '/?view=inbox',
      Priority: '/priority',
      Completed: '/completed',
      Code: '/code',
      Backlog: '/code/backlog',
    });
  });

  it('routes a folder to /folders/{id} and a project to /code/{id} with its key pill', () => {
    const grouped = buildDestinations('', [makeFolder({ id: 'fa' })], [makeProject({ id: 'pa' })]);
    expect(grouped.folders[0]?.href).toBe('/folders/fa');
    expect(grouped.projects[0]?.href).toBe('/code/pa');
    expect(grouped.projects[0]?.key).toBe('PRJ');
  });

  it('filters case-insensitively across all groups, dropping non-matches', () => {
    const folders = [
      makeFolder({ id: 'fa', name: 'Software' }),
      makeFolder({ id: 'fb', name: 'Hardware' }),
    ];
    const projects = [
      makeProject({ id: 'pa', name: 'Software Factory', key: 'SFT' }),
      makeProject({ id: 'pb', name: 'Alfred', key: 'ALF' }),
    ];
    const grouped = buildDestinations('SOFT', folders, projects);

    expect(grouped.go).toHaveLength(0);
    expect(grouped.folders.map((d) => d.label)).toEqual(['Software']);
    expect(grouped.projects.map((d) => d.label)).toEqual(['Software Factory']);
  });

  it('ranks label-prefix matches above label-substring matches', () => {
    const folders = [
      makeFolder({ id: 'sub', name: 'My fire drill' }),
      makeFolder({ id: 'pre', name: 'Fire escape' }),
    ];
    const grouped = buildDestinations('fire', folders, []);
    expect(grouped.folders.map((d) => d.id)).toEqual(['folder-pre', 'folder-sub']);
  });

  it('matches a project on its key as well as its name', () => {
    const projects = [
      makeProject({ id: 'pa', name: 'Alfred', key: 'ALF' }),
      makeProject({ id: 'pb', name: 'Beacon', key: 'BCN' }),
    ];
    const grouped = buildDestinations('alf', [], projects);
    expect(grouped.projects.map((d) => d.id)).toEqual(['project-pa']);
  });

  it('keeps a group header only for groups with at least one match', () => {
    const grouped = buildDestinations('priority', [makeFolder()], [makeProject()]);
    expect(grouped.go.map((d) => d.label)).toEqual(['Priority']);
    expect(grouped.folders).toHaveLength(0);
    expect(grouped.projects).toHaveLength(0);
  });
});

describe('flattenDestinations', () => {
  it('concatenates go → folders → projects in order', () => {
    const grouped = buildDestinations(
      '',
      [makeFolder({ id: 'fa', name: 'Software' })],
      [makeProject({ id: 'pa', name: 'Alfred' })],
    );
    const flat = flattenDestinations(grouped);
    expect(flat.map((d) => d.group)).toEqual([
      'go',
      'go',
      'go',
      'go',
      'go',
      'go',
      'folders',
      'projects',
    ]);
    expect(flat.at(-1)?.label).toBe('Alfred');
  });
});

describe('destinationDomId', () => {
  it('produces a stable, unique id per destination', () => {
    const grouped = buildDestinations('', [makeFolder({ id: 'fa' })], [makeProject({ id: 'pa' })]);
    expect(grouped.folders.map((d) => destinationDomId(d))).toEqual([
      'command-destination-folder-fa',
    ]);
    expect(grouped.projects.map((d) => destinationDomId(d))).toEqual([
      'command-destination-project-pa',
    ]);
  });
});
