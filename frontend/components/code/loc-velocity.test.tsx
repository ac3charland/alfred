import { act, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { COMPUTING_POLL_MS } from '@/lib/hooks/use-loc-velocity';
import type { LocVelocityResponse, LocWeek } from '@/lib/types';

import { LocVelocity } from './loc-velocity';

jest.mock('@/lib/api-client');
const mockGetLocVelocity = jest.mocked(api.getLocVelocity);

/** Twelve weeks ending Sunday 6 Sep 2026, the last of them still in progress. */
function makeWeeks(lines: number[]): LocWeek[] {
  const firstSunday = Date.parse('2026-06-21T00:00:00Z');
  return lines.map((value, index) => {
    const partial = index === lines.length - 1;
    return {
      week: new Date(firstSunday + index * 604_800_000).toISOString().slice(0, 10),
      lines: value,
      average: partial ? null : value,
      partial,
    };
  });
}

function makeVelocity(lines: number[]): LocVelocityResponse {
  return {
    weeks: makeWeeks(lines),
    repos: ['ac3charland/alfred'],
    authors: ['ac3charland'],
    averageWeeks: 4,
  };
}

const LINES = [3000, 3200, 3100, 4500, 4300, 4400, 5300, 5000, 5600, 6140, 5900, 1980];

describe('LocVelocity', () => {
  beforeEach(() => {
    mockGetLocVelocity.mockReset();
  });

  it('renders nothing at all — no card, no gap — when the deployment is unconfigured', async () => {
    mockGetLocVelocity.mockResolvedValue({ status: 'unconfigured' });

    const { container } = render(<LocVelocity />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('says so, without asking for a manual refresh, while GitHub is still computing the statistics', async () => {
    mockGetLocVelocity.mockResolvedValue({ status: 'computing' });

    render(<LocVelocity />);

    expect(
      await screen.findByText(/GitHub is still computing these statistics/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument();
  });

  it('polls in the background and swaps in the chart on its own once GitHub finishes', async () => {
    jest.useFakeTimers();
    try {
      mockGetLocVelocity
        .mockResolvedValueOnce({ status: 'computing' })
        .mockResolvedValueOnce({ status: 'ready', velocity: makeVelocity(LINES) });

      render(<LocVelocity />);

      expect(
        await screen.findByText(/GitHub is still computing these statistics/),
      ).toBeInTheDocument();
      expect(mockGetLocVelocity).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(COMPUTING_POLL_MS);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockGetLocVelocity).toHaveBeenCalledTimes(2);
      });
      expect(await screen.findByText(/4-week average 5,900/)).toBeInTheDocument();

      // The chart landed — a later tick must not fire a third, now-pointless fetch.
      await act(async () => {
        jest.advanceTimersByTime(COMPUTING_POLL_MS * 3);
        await Promise.resolve();
      });
      expect(mockGetLocVelocity).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels the pending poll on unmount, so an unmounted card never fetches again', async () => {
    jest.useFakeTimers();
    try {
      mockGetLocVelocity.mockResolvedValue({ status: 'computing' });

      const { unmount } = render(<LocVelocity />);
      await screen.findByText(/GitHub is still computing these statistics/);
      expect(mockGetLocVelocity).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        jest.advanceTimersByTime(COMPUTING_POLL_MS * 3);
        await Promise.resolve();
      });

      expect(mockGetLocVelocity).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows one muted line when GitHub would not answer', async () => {
    mockGetLocVelocity.mockRejectedValue(new Error('502'));

    render(<LocVelocity />);

    expect(await screen.findByText("Couldn't load line counts.")).toBeInTheDocument();
  });

  it('reserves the plot’s height while the series is in flight', () => {
    mockGetLocVelocity.mockReturnValue(new Promise(() => {}));

    render(<LocVelocity />);

    expect(screen.getByRole('heading', { name: 'Lines changed per week' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says so plainly when every week in the window is zero', async () => {
    mockGetLocVelocity.mockResolvedValue({
      status: 'ready',
      velocity: makeVelocity(Array.from({ length: 12 }, () => 0)),
    });

    render(<LocVelocity />);

    expect(await screen.findByText('No lines changed in the last 12 weeks.')).toBeInTheDocument();
    // A zero-height plot reads as broken, so none is drawn.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('details the window’s range and the LAST COMPLETE week’s trailing average', async () => {
    mockGetLocVelocity.mockResolvedValue({ status: 'ready', velocity: makeVelocity(LINES) });

    render(<LocVelocity />);

    // Jun 21 through the last day the in-progress week covers, then the average from the last
    // week that HAS one — never the in-progress week's, which is deliberately withheld.
    expect(await screen.findByText(/Jun 21 – Sep 12/)).toBeInTheDocument();
    expect(screen.getByText(/4-week average 5,900/)).toBeInTheDocument();
  });

  it('names exactly the three marks the plot draws, and nothing more', async () => {
    mockGetLocVelocity.mockResolvedValue({ status: 'ready', velocity: makeVelocity(LINES) });

    render(<LocVelocity />);

    const legend = await screen.findAllByRole('listitem');
    expect(legend.map((entry) => entry.textContent)).toStrictEqual([
      'Lines changed',
      '4-week average',
      'This week so far',
    ]);
  });

  it('labels each week with its Sunday, in UTC, oldest first', async () => {
    mockGetLocVelocity.mockResolvedValue({ status: 'ready', velocity: makeVelocity(LINES) });

    render(<LocVelocity />);

    await screen.findByRole('img');
    expect(screen.getByText('Jun 21')).toBeInTheDocument();
    expect(screen.getByText('Sep 6')).toBeInTheDocument();
  });

  it('flags the in-progress week in its hover readout', async () => {
    mockGetLocVelocity.mockResolvedValue({ status: 'ready', velocity: makeVelocity(LINES) });

    render(<LocVelocity />);

    expect(await screen.findByTitle('Sep 6 – Sep 12 · 1,980 lines (so far)')).toBeInTheDocument();
    expect(screen.getByTitle('Aug 30 – Sep 5 · 5,900 lines')).toBeInTheDocument();
  });
});
