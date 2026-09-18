import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { makeReaderPost } from '@/lib/reader/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { ReaderNav } from './reader-nav';

const mockPathname = jest.fn<string, []>(() => '/reader');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

beforeEach(() => {
  mockPathname.mockReturnValue('/reader');
  jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

describe('ReaderNav', () => {
  it('exposes a labelled nav with the three Reader links', () => {
    renderWithProviders(<ReaderNav />);

    const nav = screen.getByRole('navigation', { name: 'Reader' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reading list' })).toHaveAttribute('href', '/reader');
    expect(screen.getByRole('link', { name: 'Archive' })).toHaveAttribute(
      'href',
      '/reader/archive',
    );
    expect(screen.getByRole('link', { name: 'Publications' })).toHaveAttribute(
      'href',
      '/reader/publications',
    );
  });

  it('badges the Reading list with the count of unarchived posts, whatever their summary state', () => {
    renderWithProviders(<ReaderNav />, {
      reader: {
        posts: [
          makeReaderPost('pub-1', { summary_state: 'done' }),
          makeReaderPost('pub-1', { summary_state: 'pending' }),
          makeReaderPost('pub-1', { summary_state: 'done', archived_at: '2026-09-16T10:00:00Z' }),
        ],
      },
    });

    expect(screen.getByLabelText('2 to read')).toHaveTextContent('2');
  });

  it('hides the badge when there is nothing to read — the resting state', () => {
    renderWithProviders(<ReaderNav />);

    expect(screen.getByRole('link', { name: 'Reading list' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/to read/)).not.toBeInTheDocument();
  });

  it('highlights the active route by exact match', () => {
    mockPathname.mockReturnValue('/reader/archive');
    renderWithProviders(<ReaderNav />);

    expect(screen.getByRole('link', { name: 'Archive' })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: 'Reading list' })).not.toHaveClass('bg-secondary');
  });

  it('calls onClose when a link is clicked', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    renderWithProviders(<ReaderNav onClose={onClose} />);

    await user.click(screen.getByRole('link', { name: 'Reading list' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
