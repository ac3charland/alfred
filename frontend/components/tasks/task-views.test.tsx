import { render, screen } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

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
jest.mock('./completed-view', () => ({
  CompletedView: function MockCompletedView() {
    return <div data-testid="completed-view" />;
  },
}));

const mockPathname = jest.mocked(usePathname);
const mockSearchParams = jest.mocked(useSearchParams);

function setLocation(pathname: string, query = ''): void {
  mockPathname.mockReturnValue(pathname);
  mockSearchParams.mockReturnValue(
    new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>,
  );
}

describe('TaskViews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the inbox (closed) on the bare landing route', () => {
    setLocation('/');
    render(<TaskViews />);

    expect(screen.getByTestId('inbox-screen')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('folder-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('completed-view')).not.toBeInTheDocument();
  });

  it('opens the inbox list when ?view=inbox is present', () => {
    setLocation('/', 'view=inbox');
    render(<TaskViews />);

    expect(screen.getByTestId('inbox-screen')).toHaveAttribute('data-open', 'true');
  });

  it('renders the folder view for a /folders/<id> path, passing the id', () => {
    setLocation('/folders/f1');
    render(<TaskViews />);

    expect(screen.getByTestId('folder-view')).toHaveAttribute('data-folder-id', 'f1');
    expect(screen.queryByTestId('inbox-screen')).not.toBeInTheDocument();
  });

  it('renders the completed view on /completed', () => {
    setLocation('/completed');
    render(<TaskViews />);

    expect(screen.getByTestId('completed-view')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-screen')).not.toBeInTheDocument();
  });
});
