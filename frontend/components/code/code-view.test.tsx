import { screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';

import { CodeView } from './code-view';

// The active view derives purely from the URL; drive the pathname from a test variable.
let mockPathname = '/code/backlog';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Stub the two heavy view routers — this suite covers CodeView's navigation refetch, not
// what the board/backlog render (and it keeps their ESM-only deps out of the test).
jest.mock('./board', () => ({ Board: () => <div>board</div> }));
jest.mock('./backlog', () => ({ Backlog: () => <div>backlog</div> }));
jest.mock('./needs-human-action', () => ({
  NeedsHumanAction: () => <div>needs-human-action</div>,
}));

// The navigation refetch goes through the store → api-client.listCode; mock the seam.
jest.mock('@/lib/api-client');
const mockListCode = jest.mocked(api.listCode);

// Stub the realtime channel so the CodeProvider mounts without a live connection.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel: () => Promise.resolve('ok') };
  },
}));

beforeEach(() => {
  mockListCode.mockReset();
  mockListCode.mockResolvedValue([]);
  mockPathname = '/code/backlog';
});

describe('CodeView navigation refetch (ALF-69)', () => {
  it('refetches ticket statuses when the module is entered', async () => {
    renderWithProviders(<CodeView />);

    await waitFor(() => {
      expect(mockListCode).toHaveBeenCalledTimes(1);
    });
  });

  it('refetches again on each project ↔ backlog navigation', async () => {
    const { rerender } = renderWithProviders(<CodeView />);
    await waitFor(() => {
      expect(mockListCode).toHaveBeenCalledTimes(1);
    });

    // Navigate to a project board — the pathname changes, so the refetch fires again.
    mockPathname = '/code/p1';
    rerender(<CodeView />);
    await waitFor(() => {
      expect(mockListCode).toHaveBeenCalledTimes(2);
    });

    // Back to the Backlog — another navigation, another refetch.
    mockPathname = '/code/backlog';
    rerender(<CodeView />);
    await waitFor(() => {
      expect(mockListCode).toHaveBeenCalledTimes(3);
    });
  });

  it('does not refetch on a re-render that leaves the path unchanged', async () => {
    const { rerender } = renderWithProviders(<CodeView />);
    await waitFor(() => {
      expect(mockListCode).toHaveBeenCalledTimes(1);
    });

    rerender(<CodeView />);
    // Give any stray effect a chance to fire before asserting it did not.
    await Promise.resolve();
    expect(mockListCode).toHaveBeenCalledTimes(1);
  });
});

describe('CodeView view routing', () => {
  it('renders the Backlog for the bare /code and /code/backlog paths', () => {
    mockPathname = '/code';
    const { rerender } = renderWithProviders(<CodeView />);
    expect(screen.getByText('backlog')).toBeInTheDocument();

    mockPathname = '/code/backlog';
    rerender(<CodeView />);
    expect(screen.getByText('backlog')).toBeInTheDocument();
  });

  it('renders the Needs human action view for the /code/needs-human-action segment (ALF-103)', () => {
    mockPathname = '/code/needs-human-action';
    renderWithProviders(<CodeView />);
    expect(screen.getByText('needs-human-action')).toBeInTheDocument();
    expect(screen.queryByText('backlog')).not.toBeInTheDocument();
    expect(screen.queryByText('board')).not.toBeInTheDocument();
  });

  it('renders a project Board for a project-id segment', () => {
    mockPathname = '/code/p1';
    renderWithProviders(<CodeView />);
    expect(screen.getByText('board')).toBeInTheDocument();
  });
});
