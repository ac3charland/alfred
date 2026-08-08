import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import { CodeFilterProvider } from '@/lib/stores/code-filter-store';
import type { Project } from '@/lib/types';

import { useProjectFilter } from './use-project-filter';

function makeProject(id: string, name: string): Project {
  return {
    description: null,
    id,
    name,
    key: name.slice(0, 3).toUpperCase(),
    repo_owner: 'ac3charland',
    repo_name: name.toLowerCase(),
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  };
}

const PROJECTS: Project[] = [
  makeProject('p1', 'Alfred'),
  makeProject('p2', 'Relay'),
  makeProject('p3', 'Beacon'),
];

// The hook reads/writes the layout-mounted CodeFilterProvider, so every render needs one.
function wrapper({ children }: { children: React.ReactNode }) {
  return <CodeFilterProvider>{children}</CodeFilterProvider>;
}

describe('useProjectFilter', () => {
  it('starts with every project selected and reports not filtering', () => {
    const { result } = renderHook(() => useProjectFilter('backlog', PROJECTS), { wrapper });

    expect(result.current.projectIds).toEqual(['p1', 'p2', 'p3']);
    expect(result.current.isFiltering).toBe(false);
  });

  it('drops a project on toggle and flags filtering', () => {
    const { result } = renderHook(() => useProjectFilter('backlog', PROJECTS), { wrapper });

    act(() => {
      result.current.toggle('p2');
    });

    expect(result.current.projectIds).toEqual(['p1', 'p3']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('re-adds a project on a second toggle and returns to not-filtering', () => {
    const { result } = renderHook(() => useProjectFilter('backlog', PROJECTS), { wrapper });

    act(() => {
      result.current.toggle('p2');
    });
    act(() => {
      result.current.toggle('p2');
    });

    expect(result.current.projectIds).toEqual(['p1', 'p3', 'p2']);
    // Same membership as the default (order is irrelevant) → back to the resting state.
    expect(result.current.isFiltering).toBe(false);
  });

  it('replaces the whole selection via setProjectIds', () => {
    const { result } = renderHook(() => useProjectFilter('backlog', PROJECTS), { wrapper });

    act(() => {
      result.current.setProjectIds(['p3']);
    });

    expect(result.current.projectIds).toEqual(['p3']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('keeps the selection referentially stable across re-renders so selectors do not rerun', () => {
    const { result, rerender } = renderHook(() => useProjectFilter('backlog', PROJECTS), {
      wrapper,
    });

    const first = result.current.projectIds;
    rerender();

    expect(result.current.projectIds).toBe(first);
  });

  it('keeps each key independent under one provider', () => {
    const { result } = renderHook(
      () => ({
        backlog: useProjectFilter('backlog', PROJECTS),
        other: useProjectFilter('other-view', PROJECTS),
      }),
      { wrapper },
    );

    act(() => {
      result.current.backlog.toggle('p1');
    });

    expect(result.current.backlog.projectIds).toEqual(['p2', 'p3']);
    expect(result.current.other.projectIds).toEqual(['p1', 'p2', 'p3']);
    expect(result.current.other.isFiltering).toBe(false);
  });

  it('leaves an explicit selection alone when a new project is created', () => {
    // A stored selection is the owner's explicit choice: a project created afterwards is not
    // silently folded into it (it stays unchecked until they check it).
    const { result, rerender } = renderHook(
      ({ projects }: { projects: Project[] }) => useProjectFilter('backlog', projects),
      { wrapper, initialProps: { projects: PROJECTS } },
    );

    act(() => {
      result.current.toggle('p3');
    });

    rerender({ projects: [...PROJECTS, makeProject('p4', 'Corral')] });

    expect(result.current.projectIds).toEqual(['p1', 'p2']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('follows the live project list while the selection is still at its default', () => {
    const { result, rerender } = renderHook(
      ({ projects }: { projects: Project[] }) => useProjectFilter('backlog', projects),
      { wrapper, initialProps: { projects: PROJECTS } },
    );

    rerender({ projects: [...PROJECTS, makeProject('p4', 'Corral')] });

    expect(result.current.projectIds).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(result.current.isFiltering).toBe(false);
  });
});
