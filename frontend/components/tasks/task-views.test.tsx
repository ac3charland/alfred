import { screen, waitFor } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';

import { TaskViews } from './task-views';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Stub the three views — each test only cares which one renders and with what props.
jest.mock('./inbox-screen', () => ({
  InboxScreen: function MockInboxScreen({ open }: { open: boolean }) {
    return <div data-testid="inbox-screen" data-open={String(open)} />;
  },
}));
jest.mock('./folder-view', () => ({
  FolderView: function MockFolderView({ folderId }: { folderId: string }) {
    return <div data-testid="folder-view" data-folder-id={folderId} />;
  },
}));
jest.mock('./today-view', () => ({
  TodayView: function MockTodayView() {
    return <div data-testid="today-view" />;
  },
}));
jest.mock('./completed-view', () => ({
  CompletedView: function MockCompletedView() {
    return <div data-testid="completed-view" />;
  },
}));
jest.mock('@/components/habits/habits-view', () => ({
  HabitsView: function MockHabitsView() {
    return <div data-testid="habits-view" />;
  },
}));

// The navigation refetch goes through the store → api-client.listItems; mock the seam.
jest.mock('@/lib/api-client');
const mockListItems = jest.mocked(api.listItems);

const mockPathname = jest.mocked(usePathname);
const mockSearchParams = jest.mocked(useSearchParams);

function setLocation(pathname: string, query = ''): void {
  mockPathname.mockReturnValue(pathname);
  mockSearchParams.mockReturnValue(
    new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>,
  );
}

beforeEach(() => {
  mockListItems.mockResolvedValue([]);
  setLocation('/');
});

describe('TaskViews navigation refetch (ALF-246)', () => {
  it('refetches classifier verdicts when the module is entered', async () => {
    renderWithProviders(<TaskViews />);

    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalledTimes(1);
    });
    expect(mockListItems).toHaveBeenCalledWith({ status: 'all' });
  });

  it('refetches again on each in-module navigation', async () => {
    const { rerender } = renderWithProviders(<TaskViews />);
    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalledTimes(1);
    });

    setLocation('/today');
    rerender(<TaskViews />);
    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalledTimes(2);
    });

    setLocation('/completed');
    rerender(<TaskViews />);
    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalledTimes(3);
    });
  });

  it('does not refetch on a re-render that leaves the path unchanged', async () => {
    const { rerender } = renderWithProviders(<TaskViews />);
    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalledTimes(1);
    });

    rerender(<TaskViews />);
    // Give any stray effect a chance to fire before asserting it did not.
    await Promise.resolve();
    expect(mockListItems).toHaveBeenCalledTimes(1);
  });
});

describe('TaskViews view routing', () => {
  it('renders the inbox (closed) on the bare landing route', () => {
    setLocation('/');
    renderWithProviders(<TaskViews />);

    expect(screen.getByTestId('inbox-screen')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('folder-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('completed-view')).not.toBeInTheDocument();
  });

  it('opens the inbox list when ?view=inbox is present', () => {
    setLocation('/', 'view=inbox');
    renderWithProviders(<TaskViews />);

    expect(screen.getByTestId('inbox-screen')).toHaveAttribute('data-open', 'true');
  });

  it('renders the folder view for a /folders/<id> path, passing the id', () => {
    setLocation('/folders/f1');
    renderWithProviders(<TaskViews />);

    expect(screen.getByTestId('folder-view')).toHaveAttribute('data-folder-id', 'f1');
    expect(screen.queryByTestId('inbox-screen')).not.toBeInTheDocument();
  });

  it('renders the habits view on /habits', () => {
    setLocation('/habits');
    renderWithProviders(<TaskViews />);

    expect(screen.getByTestId('habits-view')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-screen')).not.toBeInTheDocument();
  });

  it('renders the today view on /today', () => {
    setLocation('/today');
    renderWithProviders(<TaskViews />);

    expect(screen.getByTestId('today-view')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-screen')).not.toBeInTheDocument();
  });

  it('renders the completed view on /completed', () => {
    setLocation('/completed');
    renderWithProviders(<TaskViews />);

    expect(screen.getByTestId('completed-view')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-screen')).not.toBeInTheDocument();
  });
});
