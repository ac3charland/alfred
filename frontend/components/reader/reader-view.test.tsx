import { screen } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { readerFixtureSet } from '@/lib/reader/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { ReaderView } from './reader-view';

// The archive segment reads its own scope on first visit; the router test only cares that the
// right view rendered, so the read answers with nothing.
jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

beforeEach(() => {
  mockApi.fetchReaderPosts.mockResolvedValue([]);
});

const mockPathname = jest.fn<string, []>(() => '/reader');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

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
