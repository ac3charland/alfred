import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import type { PrRatioResponse } from '@/lib/types';

import { PrRatio } from './pr-ratio';

jest.mock('@/lib/api-client');
const mockGetPrRatio = jest.mocked(api.getPrRatio);

const RATIO: PrRatioResponse = {
  week: {
    // The seven days ending at a Friday-afternoon request — a rolling window, not a
    // calendar week, so neither end sits at midnight.
    start: '2026-07-17T16:00:00-04:00',
    end: '2026-07-24T16:00:00-04:00',
    timezone: 'America/New_York',
  },
  total: 9,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
  ],
};

/** The same window with a measured Other bucket, which shifts every share. */
const RATIO_WITH_OTHER: PrRatioResponse = {
  ...RATIO,
  total: 10,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 30 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 60 },
  ],
  other: { count: 1, percentage: 10 },
};

/** A never-settling fetch, so the loading state can be asserted before data lands. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe('PrRatio', () => {
  it('reserves the card with a skeleton bar while the counts are in flight', () => {
    mockGetPrRatio.mockReturnValue(pending());

    render(<PrRatio />);

    expect(screen.getByText('PRs merged in the last 7 days')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a percentage and a raw count per repo, in configured order', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    render(<PrRatio />);

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['RealPlay33%(3)', 'Alfred67%(6)']);
  });

  it('names the window by the first and last day it covers, both inclusive', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    render(<PrRatio />);

    expect(await screen.findByText(/Jul 17 – Jul 24/)).toBeInTheDocument();
    expect(screen.getByText(/9 total/)).toBeInTheDocument();
  });

  it("spells the split out in the bar's accessible label", async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    render(<PrRatio />);

    expect(
      await screen.findByRole('img', {
        name: 'RealPlay 33 percent, 3 pull requests; Alfred 67 percent, 6 pull requests',
      }),
    ).toBeInTheDocument();
  });

  it('adds an Other entry after the configured repos for the PRs merged elsewhere', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO_WITH_OTHER);

    render(<PrRatio />);

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'RealPlay30%(3)',
      'Alfred60%(6)',
      'Other10%(1)',
    ]);
  });

  it('names Other in the accessible label too, so the bar and the legend agree', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO_WITH_OTHER);

    render(<PrRatio />);

    expect(
      await screen.findByRole('img', {
        name: 'RealPlay 30 percent, 3 pull requests; Alfred 60 percent, 6 pull requests; Other 10 percent, 1 pull request',
      }),
    ).toBeInTheDocument();
  });

  it('drops the Other entry when nothing merged outside the configured repos', async () => {
    mockGetPrRatio.mockResolvedValue({ ...RATIO, other: { count: 0, percentage: 0 } });

    render(<PrRatio />);

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['RealPlay33%(3)', 'Alfred67%(6)']);
  });

  it('renders no Other entry when the deployment cannot measure the bucket', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    render(<PrRatio />);

    await screen.findByRole('img');
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('keeps a configured repo listed at zero — only Other is dropped when empty', async () => {
    mockGetPrRatio.mockResolvedValue({
      ...RATIO,
      total: 4,
      repos: RATIO.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
      other: { count: 4, percentage: 100 },
    });

    render(<PrRatio />);

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'RealPlay0%(0)',
      'Alfred0%(0)',
      'Other100%(4)',
    ]);
    expect(screen.getByText(/4 total/)).toBeInTheDocument();
  });

  it('reports a zero-PR window as a normal state rather than an empty or NaN bar', async () => {
    mockGetPrRatio.mockResolvedValue({
      ...RATIO,
      total: 0,
      repos: RATIO.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
    });

    render(<PrRatio />);

    expect(await screen.findByText('No PRs merged in the last 7 days.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a muted line when the counts could not be loaded', async () => {
    mockGetPrRatio.mockRejectedValue(new Error('502 GitHub request failed'));

    render(<PrRatio />);

    expect(await screen.findByText("Couldn't load PR counts.")).toBeInTheDocument();
  });

  it('renders NOTHING when the deployment reports the feature unconfigured', async () => {
    mockGetPrRatio.mockResolvedValue(undefined);

    const { container } = render(<PrRatio />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("renders the window in the browser's own timezone", async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    render(<PrRatio />);

    await screen.findByRole('img');
    expect(mockGetPrRatio).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
