import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import { CodeFilterProvider } from '@/lib/stores/code-filter-store';
import type { CodeFactoryState } from '@/lib/types';

import { useStatusFilter } from './use-status-filter';

const DEFAULT: readonly CodeFactoryState[] = ['needs_refinement', 'in_development'];

// The hook now reads/writes the layout-mounted CodeFilterProvider, so every render needs one.
function wrapper({ children }: { children: React.ReactNode }) {
  return <CodeFilterProvider>{children}</CodeFilterProvider>;
}

describe('useStatusFilter', () => {
  it('starts at the default selection and reports not filtering', () => {
    const { result } = renderHook(() => useStatusFilter('backlog', DEFAULT), { wrapper });

    expect(result.current.statuses).toEqual(DEFAULT);
    expect(result.current.isFiltering).toBe(false);
  });

  it('removes a selected state on toggle and flags filtering', () => {
    const { result } = renderHook(() => useStatusFilter('backlog', DEFAULT), { wrapper });

    act(() => {
      result.current.toggle('needs_refinement');
    });

    expect(result.current.statuses).toEqual(['in_development']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('adds an unselected state on toggle and flags filtering (a wider selection)', () => {
    const { result } = renderHook(() => useStatusFilter('backlog', DEFAULT), { wrapper });

    act(() => {
      result.current.toggle('done');
    });

    expect(result.current.statuses).toEqual([...DEFAULT, 'done']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('replaces the whole selection via setStatuses (a preset macro jump)', () => {
    const { result } = renderHook(() => useStatusFilter('backlog', DEFAULT), { wrapper });

    act(() => {
      result.current.setStatuses(['ready_for_review']);
    });

    expect(result.current.statuses).toEqual(['ready_for_review']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('returns to not-filtering when the selection matches the default again', () => {
    const { result } = renderHook(() => useStatusFilter('backlog', DEFAULT), { wrapper });

    act(() => {
      result.current.toggle('done');
    });
    act(() => {
      result.current.toggle('done');
    });

    expect(result.current.statuses).toEqual(DEFAULT);
    expect(result.current.isFiltering).toBe(false);
  });

  it('keeps each key independent under one provider', () => {
    // Two views share the provider but hold separate selections by key — toggling one leaves
    // the other at its default (the Backlog and a board don't share a filter).
    const { result } = renderHook(
      () => ({
        backlog: useStatusFilter('backlog', DEFAULT),
        board: useStatusFilter('project-1', DEFAULT),
      }),
      { wrapper },
    );

    act(() => {
      result.current.backlog.toggle('needs_refinement');
    });

    expect(result.current.backlog.statuses).toEqual(['in_development']);
    expect(result.current.board.statuses).toEqual(DEFAULT);
    expect(result.current.board.isFiltering).toBe(false);
  });
});
