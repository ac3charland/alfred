import { waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';

import { CommsView } from './comms-view';

// The active view derives purely from the URL; drive the pathname from a test variable.
let mockPathname = '/comms';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// The navigation refetch goes through the store → api-client.fetchCommsSnapshot; mock the seam.
jest.mock('@/lib/api-client');
const mockFetchSnapshot = jest.mocked(api.fetchCommsSnapshot);

beforeEach(() => {
  mockFetchSnapshot.mockResolvedValue({
    accounts: [],
    messages: [],
    verdicts: [],
    health: undefined,
    shelfCount: 0,
    readerClaimedCount: 0,
    lastClassifiedAt: null,
  });
  mockPathname = '/comms';
});

describe('CommsView navigation refetch (ALF-246)', () => {
  it('reconciles the snapshot when the module is entered', async () => {
    renderWithProviders(<CommsView />);

    await waitFor(() => {
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  it('reconciles again on each queue ↔ settings navigation', async () => {
    const { rerender } = renderWithProviders(<CommsView />);
    await waitFor(() => {
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(1);
    });

    mockPathname = '/comms/people';
    rerender(<CommsView />);
    await waitFor(() => {
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(2);
    });

    mockPathname = '/comms';
    rerender(<CommsView />);
    await waitFor(() => {
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(3);
    });
  });

  it('does not reconcile on a re-render that leaves the path unchanged', async () => {
    const { rerender } = renderWithProviders(<CommsView />);
    await waitFor(() => {
      expect(mockFetchSnapshot).toHaveBeenCalledTimes(1);
    });

    rerender(<CommsView />);
    // Give any stray effect a chance to fire before asserting it did not.
    await Promise.resolve();
    expect(mockFetchSnapshot).toHaveBeenCalledTimes(1);
  });
});
