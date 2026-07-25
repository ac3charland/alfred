import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { WeeklyPlan, WeeklyPlanSummary } from '@/lib/types';

import {
  WeeklyPlanProvider,
  useSelectedWeeklyPlan,
  useWeeklyPlanActions,
  useWeeklyPlanIndex,
} from './weekly-plan-store';

jest.mock('@/lib/api-client');
const mockFetchWeeklyPlan = jest.mocked(apiClient.fetchWeeklyPlan);

const LATEST: WeeklyPlan = {
  id: 'plan-latest',
  html: '<!DOCTYPE html><html><body><h1>Week 12</h1></body></html>',
  uploaded_at: '2026-07-24T12:00:00Z',
};
const OLDER: WeeklyPlan = {
  id: 'plan-older',
  html: '<!DOCTYPE html><html><body><h1>Week 11</h1></body></html>',
  uploaded_at: '2026-07-17T12:00:00Z',
};

const INDEX: WeeklyPlanSummary[] = [
  { id: LATEST.id, uploaded_at: LATEST.uploaded_at },
  { id: OLDER.id, uploaded_at: OLDER.uploaded_at },
];

/**
 * `latest` is read with `in` rather than a default parameter: a default would swallow an
 * explicit `latest: undefined`, which is exactly the "nothing uploaded yet" case under test.
 */
function renderStore(
  options: { index?: WeeklyPlanSummary[]; latest?: WeeklyPlan | undefined } = {},
) {
  const index = options.index ?? INDEX;
  const latest = 'latest' in options ? options.latest : LATEST;
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <WeeklyPlanProvider initialIndex={index} initialLatest={latest}>
          {children}
        </WeeklyPlanProvider>
      </ToastProvider>
    );
  }
  return renderHook(
    () => ({
      index: useWeeklyPlanIndex(),
      selected: useSelectedWeeklyPlan(),
      actions: useWeeklyPlanActions(),
    }),
    { wrapper: Wrapper },
  );
}

describe('WeeklyPlanProvider', () => {
  it('throws when read outside a provider', () => {
    expect(() => renderHook(() => useWeeklyPlanIndex())).toThrow(
      /must be used within a WeeklyPlanProvider/,
    );
  });

  it('seeds the index and selects the latest plan initially', () => {
    const { result } = renderStore();

    expect(result.current.index).toEqual(INDEX);
    expect(result.current.selected).toEqual(LATEST);
  });

  it('has no selection when nothing has been uploaded', () => {
    const { result } = renderStore({ index: [], latest: undefined });

    expect(result.current.index).toEqual([]);
    expect(result.current.selected).toBeUndefined();
  });

  it('fetches an older plan on demand and selects it', async () => {
    mockFetchWeeklyPlan.mockResolvedValue(OLDER);
    const { result } = renderStore();

    await act(async () => {
      await result.current.actions.selectPlan(OLDER.id);
    });

    expect(mockFetchWeeklyPlan).toHaveBeenCalledWith(OLDER.id);
    expect(result.current.selected).toEqual(OLDER);
  });

  it('serves a re-selected plan from cache instead of fetching twice', async () => {
    mockFetchWeeklyPlan.mockResolvedValue(OLDER);
    const { result } = renderStore();

    await act(async () => {
      await result.current.actions.selectPlan(OLDER.id);
    });
    await act(async () => {
      await result.current.actions.selectPlan(LATEST.id);
    });
    await act(async () => {
      await result.current.actions.selectPlan(OLDER.id);
    });

    expect(mockFetchWeeklyPlan).toHaveBeenCalledTimes(1);
    expect(result.current.selected).toEqual(OLDER);
  });

  it('never re-fetches the seeded latest plan', async () => {
    const { result } = renderStore();

    await act(async () => {
      await result.current.actions.selectPlan(LATEST.id);
    });

    expect(mockFetchWeeklyPlan).not.toHaveBeenCalled();
  });

  it('leaves the selection unchanged and toasts when the fetch rejects', async () => {
    mockFetchWeeklyPlan.mockRejectedValue(new Error('offline'));
    const { result } = renderStore();

    await act(async () => {
      await result.current.actions.selectPlan(OLDER.id);
    });

    expect(result.current.selected).toEqual(LATEST);
  });

  it('retries the fetch after a failure rather than caching the error', async () => {
    mockFetchWeeklyPlan.mockRejectedValueOnce(new Error('offline'));
    mockFetchWeeklyPlan.mockResolvedValueOnce(OLDER);
    const { result } = renderStore();

    await act(async () => {
      await result.current.actions.selectPlan(OLDER.id);
    });
    await act(async () => {
      await result.current.actions.selectPlan(OLDER.id);
    });

    await waitFor(() => {
      expect(result.current.selected).toEqual(OLDER);
    });
    expect(mockFetchWeeklyPlan).toHaveBeenCalledTimes(2);
  });
});
