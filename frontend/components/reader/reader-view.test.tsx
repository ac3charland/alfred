import { screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { readerFixtureSet } from '@/lib/reader/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { ReaderView } from './reader-view';

// The archive segment reads its own scope on first visit; the router test only cares that the
// right view rendered, so the read answers with nothing. The navigation refetch (ALF-246) goes
// through the same mocked seam (fetchReaderPosts / fetchReaderHealth).
jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

beforeEach(() => {
  mockApi.fetchReaderPosts.mockResolvedValue([]);
  mockApi.fetchReaderHealth.mockResolvedValue({ health: undefined, account: undefined });
});

const mockPathname = jest.fn<string, []>(() => '/reader');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

describe('ReaderView navigation refetch (ALF-246)', () => {
  it('refreshes the list and health when the module is entered', async () => {
    mockPathname.mockReturnValue('/reader');
    renderWithProviders(<ReaderView />);

    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    });
    expect(mockApi.fetchReaderHealth).toHaveBeenCalledTimes(1);
  });

  it('refreshes again on each reading-list ↔ settings navigation', async () => {
    mockPathname.mockReturnValue('/reader');
    const { rerender } = renderWithProviders(<ReaderView />);
    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    });

    mockPathname.mockReturnValue('/reader/publications');
    rerender(<ReaderView />);
    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(2);
    });

    mockPathname.mockReturnValue('/reader');
    rerender(<ReaderView />);
    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(3);
    });
  });

  it('does not refresh on a re-render that leaves the path unchanged', async () => {
    mockPathname.mockReturnValue('/reader');
    const { rerender } = renderWithProviders(<ReaderView />);
    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    });

    rerender(<ReaderView />);
    // Give any stray effect a chance to fire before asserting it did not.
    await Promise.resolve();
    expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
  });
});

describe('ReaderView', () => {
  it('renders the reading list, at rest, on the bare /reader segment', () => {
    mockPathname.mockReturnValue('/reader');
    renderWithProviders(<ReaderView />);

    expect(screen.getByRole('heading', { level: 2, name: 'Reader' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to read')).toBeInTheDocument();
    expect(screen.getByText('Nothing new to read.')).toBeInTheDocument();
    expect(
      screen.getByText('Newsletters from your publications land here as they arrive, summarised.'),
    ).toBeInTheDocument();
  });

  it('renders the archive on /reader/archive', async () => {
    mockPathname.mockReturnValue('/reader/archive');
    renderWithProviders(<ReaderView />);

    expect(screen.getByRole('heading', { level: 2, name: 'Archive' })).toBeInTheDocument();
    expect(
      screen.getByText("Everything you've skimmed and put away. Unarchive to bring one back."),
    ).toBeInTheDocument();
    expect(await screen.findByText('Nothing archived yet.')).toBeInTheDocument();
  });

  it('renders the publications roster on /reader/publications', () => {
    mockPathname.mockReturnValue('/reader/publications');
    renderWithProviders(<ReaderView />);

    expect(screen.getByRole('heading', { level: 2, name: 'Publications' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Who the Reader summarises. Auto-added from Substack; anyone else you promote from the candidates below.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No publications yet.')).toBeInTheDocument();
  });

  it('falls back to the reading list for an unrecognised segment', () => {
    mockPathname.mockReturnValue('/reader/something-unknown');
    renderWithProviders(<ReaderView />);

    expect(screen.getByRole('heading', { level: 2, name: 'Reader' })).toBeInTheDocument();
    expect(screen.getByText('Nothing new to read.')).toBeInTheDocument();
  });

  it('renders the seeded posts on /reader, newest first, with the count in the heading', () => {
    mockPathname.mockReturnValue('/reader');
    const { posts } = readerFixtureSet();
    renderWithProviders(<ReaderView />, { reader: { posts } });

    expect(screen.getByText(`${String(posts.length)} to read`)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(posts.length);
    expect(screen.queryByText('Nothing new to read.')).not.toBeInTheDocument();
  });
});
