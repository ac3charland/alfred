import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import { CodeFilterProvider } from '@/lib/stores/code-filter-store';

import { useProjectFilter } from './use-project-filter';

// The hook reads/writes the layout-mounted CodeFilterProvider, so every render needs one.
function wrapper({ children }: { children: React.ReactNode }) {
  return <CodeFilterProvider>{children}</CodeFilterProvider>;
}

describe('useProjectFilter', () => {
  it('starts with no project selected and reports not filtering', () => {
    const { result } = renderHook(() => useProjectFilter('backlog'), { wrapper });

    expect(result.current.projectIds).toEqual([]);
    expect(result.current.isFiltering).toBe(false);
  });

  it('narrows to just the toggled project and flags filtering (ALF-201)', () => {
    const { result } = renderHook(() => useProjectFilter('backlog'), { wrapper });

    act(() => {
      result.current.toggle('p2');
    });

    // One tap from rest INCLUDES that project rather than excluding it.
    expect(result.current.projectIds).toEqual(['p2']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('adds a second project on a further toggle', () => {
    const { result } = renderHook(() => useProjectFilter('backlog'), { wrapper });

    act(() => {
      result.current.toggle('p2');
    });
    act(() => {
      result.current.toggle('p1');
    });

    expect(result.current.projectIds).toEqual(['p2', 'p1']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('drops a project on a second toggle and returns to not-filtering when empty', () => {
    const { result } = renderHook(() => useProjectFilter('backlog'), { wrapper });

    act(() => {
      result.current.toggle('p2');
    });
    act(() => {
      result.current.toggle('p2');
    });

    expect(result.current.projectIds).toEqual([]);
    // Back at the empty resting selection → the whole Backlog again.
    expect(result.current.isFiltering).toBe(false);
  });

  it('replaces the whole selection via setProjectIds', () => {
    const { result } = renderHook(() => useProjectFilter('backlog'), { wrapper });

    act(() => {
      result.current.setProjectIds(['p3']);
    });

    expect(result.current.projectIds).toEqual(['p3']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('keeps the selection referentially stable across re-renders so selectors do not rerun', () => {
    const { result, rerender } = renderHook(() => useProjectFilter('backlog'), { wrapper });

    const first = result.current.projectIds;
    rerender();

    expect(result.current.projectIds).toBe(first);
  });

  it('keeps each key independent under one provider', () => {
    const { result } = renderHook(
      () => ({
        backlog: useProjectFilter('backlog'),
        other: useProjectFilter('other-view'),
      }),
      { wrapper },
    );

    act(() => {
      result.current.backlog.toggle('p1');
    });

    expect(result.current.backlog.projectIds).toEqual(['p1']);
    expect(result.current.other.projectIds).toEqual([]);
    expect(result.current.other.isFiltering).toBe(false);
  });
});
