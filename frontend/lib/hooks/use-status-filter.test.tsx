import { act, renderHook } from '@testing-library/react';

import type { CodeFactoryState } from '@/lib/types';

import { useStatusFilter } from './use-status-filter';

const DEFAULT: readonly CodeFactoryState[] = ['needs_refinement', 'in_development'];

describe('useStatusFilter', () => {
  it('starts at the default selection and reports not filtering', () => {
    const { result } = renderHook(() => useStatusFilter(DEFAULT));

    expect(result.current.statuses).toEqual(DEFAULT);
    expect(result.current.isFiltering).toBe(false);
  });

  it('removes a selected state on toggle and flags filtering', () => {
    const { result } = renderHook(() => useStatusFilter(DEFAULT));

    act(() => {
      result.current.toggle('needs_refinement');
    });

    expect(result.current.statuses).toEqual(['in_development']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('adds an unselected state on toggle and flags filtering (a wider selection)', () => {
    const { result } = renderHook(() => useStatusFilter(DEFAULT));

    act(() => {
      result.current.toggle('done');
    });

    expect(result.current.statuses).toEqual([...DEFAULT, 'done']);
    expect(result.current.isFiltering).toBe(true);
  });

  it('returns to not-filtering when the selection matches the default again', () => {
    const { result } = renderHook(() => useStatusFilter(DEFAULT));

    act(() => {
      result.current.toggle('done');
    });
    act(() => {
      result.current.toggle('done');
    });

    expect(result.current.statuses).toEqual(DEFAULT);
    expect(result.current.isFiltering).toBe(false);
  });
});
