import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { makeReaderCandidate, makeReaderPublicationListItem } from '@/lib/reader/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { PublicationsView } from './publications-view';

// The card and candidate row both write through the store, which calls the API client — mocked
// the same way the store's own test mocks it, so a click here never reaches a real request.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  createReaderPublication: jest.fn(),
  updateReaderPublication: jest.fn(),
}));

const NOW = new Date('2026-09-18T12:00:00.000Z');

describe('PublicationsView', () => {
  it('renders a roster card with its name, handle, provenance chip, last post and note', () => {
    const publication = makeReaderPublicationListItem('Second Thoughts', {
      handle: 'secondthoughts@substack.com',
      source: 'auto',
      notes: 'why this one',
      last_post_at: '2026-09-16T00:00:00.000Z',
    });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByText('Second Thoughts')).toBeInTheDocument();
    expect(screen.getByText(/secondthoughts@substack\.com/)).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText(/last post Sep 16/)).toBeInTheDocument();
    expect(screen.getByText('why this one')).toBeInTheDocument();
  });

  it('says a publication with no post has no posts yet', () => {
    const publication = makeReaderPublicationListItem('Fresh', { last_post_at: null });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByText(/no posts yet/)).toBeInTheDocument();
  });

  it('dims a paused card', () => {
    const publication = makeReaderPublicationListItem('Quiet', { enabled: false });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(screen.getByRole('listitem')).toHaveClass('opacity-55');
    expect(screen.getByRole('button', { name: 'Paused' })).toBeInTheDocument();
  });

  it('gives the toggle a title explaining what pausing does', () => {
    const publication = makeReaderPublicationListItem('Second Thoughts');
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [publication] },
    });

    expect(
      screen.getByTitle('Paused publications are not claimed; posts already here stay'),
    ).toBeInTheDocument();
  });

  it('counts enabled and paused publications', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: {
        publications: [
          makeReaderPublicationListItem('A', { enabled: true }),
          makeReaderPublicationListItem('B', { enabled: false }),
          makeReaderPublicationListItem('C', { enabled: false }),
        ],
      },
    });

    expect(screen.getByText('1 enabled · 2 paused')).toBeInTheDocument();
  });

  it('disables the copy button with a reason when nothing is enabled', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('A', { enabled: false })] },
    });

    const button = screen.getByRole('button', { name: /copy gmail filter query/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Nothing to copy — no publication is enabled');
  });

  it('enables the copy button when at least one publication is enabled', () => {
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { publications: [makeReaderPublicationListItem('A', { enabled: true })] },
    });

    expect(screen.getByRole('button', { name: /copy gmail filter query/i })).toBeEnabled();
  });

  it('shows the empty roster state when there are no publications', () => {
    renderWithProviders(<PublicationsView now={NOW} />, { readerSettings: { publications: [] } });

    expect(screen.getByText('No publications yet.')).toBeInTheDocument();
  });

  it('shows the empty candidates state when there are none', () => {
    renderWithProviders(<PublicationsView now={NOW} />, { readerSettings: { candidates: [] } });

    expect(screen.getByText('No candidates.')).toBeInTheDocument();
  });

  it('renders a candidate with its name, handle, count, and last-seen date', () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', {
      name: "Ben's Bites",
      message_count: 9,
      last_seen_at: '2026-09-17T00:00:00.000Z',
    });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    expect(screen.getByText("Ben's Bites")).toBeInTheDocument();
    expect(screen.getByText('hello@bensbites.beehiiv.com')).toBeInTheDocument();
    expect(screen.getByText(/9 messages · last Sep 17/)).toBeInTheDocument();
  });

  it('falls back to the handle when a candidate has no display name', () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { name: null });
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    expect(screen.getAllByText('hello@bensbites.beehiiv.com').length).toBeGreaterThan(0);
  });

  it('promotes a candidate on Add', async () => {
    const candidate = makeReaderCandidate('hello@bensbites.beehiiv.com', { name: "Ben's Bites" });
    const mockCreate = jest.mocked(apiClient.createReaderPublication);
    mockCreate.mockResolvedValue({
      id: 'new-id',
      handle: candidate.handle,
      name: "Ben's Bites",
      domain: 'bensbites.beehiiv.com',
      enabled: true,
      source: 'owner',
      notes: null,
      first_seen_at: '2026-09-17T00:00:00.000Z',
      created_at: '2026-09-17T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderWithProviders(<PublicationsView now={NOW} />, {
      readerSettings: { candidates: [candidate] },
    });

    await user.click(screen.getByRole('button', { name: /add/i }));

    // Promoted with the name the candidate row showed, so the roster card reads the same.
    expect(mockCreate).toHaveBeenCalledWith({ handle: candidate.handle, name: "Ben's Bites" });
    await screen.findByText('No candidates.');
    expect(screen.getByText("Ben's Bites")).toBeInTheDocument();
  });
});
