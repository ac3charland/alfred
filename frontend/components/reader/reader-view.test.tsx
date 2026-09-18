import { screen } from '@testing-library/react';
import * as React from 'react';

import { readerFixtureSet } from '@/lib/reader/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { ReaderView } from './reader-view';

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

  it('renders the archive placeholder on /reader/archive', () => {
    mockPathname.mockReturnValue('/reader/archive');
    renderWithProviders(<ReaderView />);

    expect(screen.getByRole('heading', { level: 2, name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByText('Reader')).toBeInTheDocument();
    expect(screen.getByText('Archived posts land here.')).toBeInTheDocument();
    expect(screen.getByText('Browsing them arrives with the next story.')).toBeInTheDocument();
  });

  it('renders the publications placeholder on /reader/publications', () => {
    mockPathname.mockReturnValue('/reader/publications');
    renderWithProviders(<ReaderView />);

    expect(screen.getByRole('heading', { level: 2, name: 'Publications' })).toBeInTheDocument();
    expect(screen.getByText('Reader')).toBeInTheDocument();
    expect(screen.getByText('Publications are managed by SQL for now.')).toBeInTheDocument();
    expect(screen.getByText('A roster view arrives with the next story.')).toBeInTheDocument();
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
