import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { PrRatioResponse, Project } from '@/lib/types';

import { PrRatio } from './pr-ratio';

jest.mock('@/lib/api-client');
const mockGetPrRatio = jest.mocked(api.getPrRatio);
const mockUpdateProject = jest.mocked(api.updateProject);

function makeProject(id: string, name: string, repoName: string, createdAt: string): Project {
  return {
    color: null,
    description: null,
    cloud_environment: null,
    exclude_from_pr_ratio: false,
    id,
    name,
    key: name.slice(0, 3).toUpperCase(),
    repo_owner: 'ac3charland',
    repo_name: repoName,
    github_url: null,
    ref_seq: 0,
    created_at: createdAt,
  };
}

/** Oldest first, as the (code) layout seeds the store: RealPlay is #1 (blue), Alfred #2 (amber). */
const REALPLAY = makeProject('p-realplay', 'RealPlay', 'realplay', '2026-01-01T00:00:00Z');
const ALFRED = makeProject('p-alfred', 'Alfred', 'alfred', '2026-02-01T00:00:00Z');
const PROJECTS = [REALPLAY, ALFRED];

/**
 * The card as the Dashboard mounts it: under a CodeProvider seeded with `projects`. It renders
 * into its own slot, since the providers around it (the toast region) add markup of their own.
 */
function renderCard(projects: Project[] = PROJECTS) {
  renderWithProviders(
    <div data-testid="card-slot">
      <PrRatio />
    </div>,
    { projects },
  );
  return { slot: screen.getByTestId('card-slot') };
}

/** The legend dot (the row's one `aria-hidden` swatch) for the entry labelled `label`. */
function legendDot(label: string): HTMLElement | null {
  const row = screen.getByText(label).closest('li');
  return row?.querySelector<HTMLElement>('span[aria-hidden="true"]') ?? null;
}

/** The bar's segment fills, left to right. */
function barFills(): string[] {
  return [...screen.getByRole('img').children].map((segment) => segment.className);
}

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

function noop(): void {
  // Placeholder until the Promise executor hands over its resolver.
}

/** A promise the test settles by hand, so the in-between state can be asserted. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = noop;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      settle(value);
    },
  };
}

/** The card's ⋯ trigger. */
function menuTrigger(): HTMLElement {
  return screen.getByRole('button', { name: 'PR ratio options' });
}

/** Open the ⋯ menu and return it. */
async function openMenu(): Promise<HTMLElement> {
  await userEvent.click(menuTrigger());
  return screen.findByRole('menu');
}

describe('PrRatio', () => {
  it('reserves the card with a skeleton bar while the counts are in flight', () => {
    mockGetPrRatio.mockReturnValue(pending());

    renderCard();

    expect(screen.getByText('PRs merged in the last 7 days')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a percentage and a raw count per project, in the order the endpoint lists them', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    renderCard();

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['RealPlay33%(3)', 'Alfred67%(6)']);
  });

  it('names the window by the first and last day it covers, both inclusive', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    renderCard();

    expect(await screen.findByText(/Jul 17 – Jul 24/)).toBeInTheDocument();
    expect(screen.getByText(/9 total/)).toBeInTheDocument();
  });

  it("spells the split out in the bar's accessible label", async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    renderCard();

    expect(
      await screen.findByRole('img', {
        name: 'RealPlay 33 percent, 3 pull requests; Alfred 67 percent, 6 pull requests',
      }),
    ).toBeInTheDocument();
  });

  it('adds an Other entry after the projects for the PRs merged elsewhere', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO_WITH_OTHER);

    renderCard();

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'RealPlay30%(3)',
      'Alfred60%(6)',
      'Other10%(1)',
    ]);
  });

  it('names Other in the accessible label too, so the bar and the legend agree', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO_WITH_OTHER);

    renderCard();

    expect(
      await screen.findByRole('img', {
        name: 'RealPlay 30 percent, 3 pull requests; Alfred 60 percent, 6 pull requests; Other 10 percent, 1 pull request',
      }),
    ).toBeInTheDocument();
  });

  it('drops the Other entry when nothing merged outside the project repos', async () => {
    mockGetPrRatio.mockResolvedValue({ ...RATIO, other: { count: 0, percentage: 0 } });

    renderCard();

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['RealPlay33%(3)', 'Alfred67%(6)']);
  });

  it('renders no Other entry when the deployment cannot measure the bucket', async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    renderCard();

    await screen.findByRole('img');
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('hides a project with no PRs merged this window', async () => {
    mockGetPrRatio.mockResolvedValue({
      ...RATIO,
      repos: [
        { repo: 'ac3charland/realplay', label: 'RealPlay', count: 0, percentage: 0 },
        { repo: 'ac3charland/alfred', label: 'Alfred', count: 9, percentage: 100 },
      ],
    });

    renderCard();

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['Alfred100%(9)']);
    // The accessible label is built from the same filtered entries — a fix that only hid the
    // legend row (and left the bar's label naming the zero-count project) would fail this.
    expect(
      await screen.findByRole('img', { name: 'Alfred 100 percent, 9 pull requests' }),
    ).toBeInTheDocument();
  });

  it('keeps a project whose count rounds down to 0% but merged a real PR', async () => {
    mockGetPrRatio.mockResolvedValue({
      ...RATIO,
      total: 251,
      repos: [
        { repo: 'ac3charland/realplay', label: 'RealPlay', count: 1, percentage: 0 },
        { repo: 'ac3charland/alfred', label: 'Alfred', count: 250, percentage: 100 },
      ],
    });

    renderCard();

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['RealPlay0%(1)', 'Alfred100%(250)']);
  });

  it('drops every zero-count project, leaving only what actually shipped', async () => {
    mockGetPrRatio.mockResolvedValue({
      ...RATIO,
      total: 4,
      repos: RATIO.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
      other: { count: 4, percentage: 100 },
    });

    renderCard();

    const entries = await screen.findAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual(['Other100%(4)']);
    expect(screen.getByText(/4 total/)).toBeInTheDocument();
  });

  it('reports a zero-PR window as a normal state rather than an empty or NaN bar', async () => {
    mockGetPrRatio.mockResolvedValue({
      ...RATIO,
      total: 0,
      repos: RATIO.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
    });

    renderCard();

    expect(await screen.findByText('No PRs merged in the last 7 days.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a muted line when the counts could not be loaded', async () => {
    mockGetPrRatio.mockRejectedValue(new Error('502 GitHub request failed'));

    renderCard();

    expect(await screen.findByText("Couldn't load PR counts.")).toBeInTheDocument();
  });

  it('renders NOTHING when the deployment reports the feature unconfigured', async () => {
    mockGetPrRatio.mockResolvedValue(undefined);

    const { slot } = renderCard();

    await waitFor(() => {
      expect(slot).toBeEmptyDOMElement();
    });
  });

  it("renders the window in the browser's own timezone", async () => {
    mockGetPrRatio.mockResolvedValue(RATIO);

    renderCard();

    await screen.findByRole('img');
    expect(mockGetPrRatio).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  describe('each project wears its own colour and links to its board', () => {
    afterEach(() => {
      // The plain-click test below navigates for real (`ViewLink` calls `history.pushState`);
      // put jsdom's URL back so later tests don't inherit '/code/p-alfred'.
      globalThis.history.replaceState(null, '', '/');
    });

    it('colours each segment and dot by the project’s creation slot, as ProjectNav does', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);

      renderCard();

      await screen.findByRole('img');
      expect(legendDot('RealPlay')).toHaveClass('bg-accent-blue');
      // The 2nd-created project is amber everywhere in the module — not the 2nd env tone (blue).
      expect(legendDot('Alfred')).toHaveClass('bg-accent-amber');
      expect(barFills()).toEqual(['bg-accent-blue', 'bg-accent-amber']);
    });

    it('takes the colour from the project’s slot in the store, not its position in the bar', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      const lumen = makeProject('p-lumen', 'Lumen', 'lumen', '2025-12-01T00:00:00Z');

      // Lumen is the oldest project, so RealPlay is #2 (amber) and Alfred #3 (green).
      renderCard([lumen, REALPLAY, ALFRED]);

      await screen.findByRole('img');
      expect(legendDot('RealPlay')).toHaveClass('bg-accent-amber');
      expect(legendDot('Alfred')).toHaveClass('bg-accent-green');
    });

    it('makes each project’s legend row a link to that project’s board', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);

      renderCard();

      const realplay = await screen.findByRole('link', { name: /RealPlay/ });
      expect(realplay).toHaveAttribute('href', '/code/p-realplay');
      expect(screen.getByRole('link', { name: /Alfred/ })).toHaveAttribute(
        'href',
        '/code/p-alfred',
      );
      // The whole row — dot, name, percent and count — is the link's content.
      expect(realplay).toHaveTextContent('RealPlay33%(3)');
    });

    it('opens the board client-side on a plain click', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      const user = userEvent.setup();

      renderCard();

      await user.click(await screen.findByRole('link', { name: /Alfred/ }));

      expect(globalThis.location.pathname).toBe('/code/p-alfred');
    });

    it('underlines the name on hover and rings the row on keyboard focus', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);

      renderCard();

      const link = await screen.findByRole('link', { name: /RealPlay/ });
      expect(link).toHaveClass('group', 'focus-visible:ring-2', 'focus-visible:ring-accent-blue');
      expect(within(link).getByText('RealPlay')).toHaveClass('group-hover:underline');
    });

    it('keeps Other plain text in the muted tone — it is not one place to go', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO_WITH_OTHER);

      renderCard();

      await screen.findByRole('img');
      expect(screen.getAllByRole('link')).toHaveLength(2);
      expect(screen.getByText('Other').closest('a')).toBeNull();
      expect(legendDot('Other')).toHaveClass('bg-muted-foreground');
      expect(barFills().at(-1)).toBe('bg-muted-foreground');
    });

    it('renders a repo with no project in the store unlinked, in the blue fallback', async () => {
      // A project created on another device since this page seeded its store.
      mockGetPrRatio.mockResolvedValue({
        ...RATIO,
        total: 10,
        repos: [
          ...RATIO.repos,
          { repo: 'ac3charland/lumen', label: 'Lumen', count: 1, percentage: 10 },
        ],
      });

      renderCard();

      await screen.findByRole('img');
      expect(screen.getByText('Lumen').closest('a')).toBeNull();
      expect(legendDot('Lumen')).toHaveClass('bg-accent-blue');
      expect(screen.getAllByRole('link')).toHaveLength(2);
    });
  });

  describe('segment identity survives colliding display labels', () => {
    it('gives each project its own bar segment even when two project names collide', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // Two distinct projects (different repos) that happen to share a display name.
      const site1 = makeProject('p-site1', 'Site', 'site1', '2026-01-01T00:00:00Z');
      const site2 = makeProject('p-site2', 'Site', 'site2', '2026-02-01T00:00:00Z');
      mockGetPrRatio.mockResolvedValue({
        ...RATIO,
        repos: [
          { repo: 'ac3charland/site1', label: 'Site', count: 3, percentage: 33 },
          { repo: 'ac3charland/site2', label: 'Site', count: 6, percentage: 67 },
        ],
      });

      renderCard([site1, site2]);

      await screen.findByRole('img');
      // One bar segment per entry. On a duplicate key React warns at mount (caught below)
      // rather than dropping one.
      expect(barFills()).toHaveLength(2);
      const links = await screen.findAllByRole('link');
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/code/p-site1',
        '/code/p-site2',
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('keeps a project named "Other" distinct from the Other bucket', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // A project literally named "Other", alongside a populated Other bucket.
      const namedOther = makeProject('p-other', 'Other', 'other-repo', '2026-01-01T00:00:00Z');
      mockGetPrRatio.mockResolvedValue({
        ...RATIO,
        total: 10,
        repos: [{ repo: 'ac3charland/other-repo', label: 'Other', count: 3, percentage: 30 }],
        other: { count: 7, percentage: 70 },
      });

      renderCard([namedOther]);

      await screen.findByRole('img');
      expect(barFills()).toHaveLength(2);
      // Only the project's row is a link — the Other bucket stays plain text either way.
      const links = await screen.findAllByRole('link');
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/code/p-other']);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('the ⋯ menu excludes projects from the ratio', () => {
    /** Created between RealPlay and Alfred, and excluded — as the knowledge repo ships. */
    const KNOWLEDGE: Project = {
      ...makeProject('p-knowledge', 'Knowledge', 'knowledge', '2026-01-15T00:00:00Z'),
      exclude_from_pr_ratio: true,
    };
    const ALL_EXCLUDED = PROJECTS.map((project) => ({ ...project, exclude_from_pr_ratio: true }));

    it('shows the ⋯ while the counts are loading', () => {
      mockGetPrRatio.mockReturnValue(pending());

      renderCard();

      expect(menuTrigger()).toBeInTheDocument();
    });

    it('shows the ⋯ beside the error line — a repo the token cannot read is excluded from there', async () => {
      mockGetPrRatio.mockRejectedValue(new Error('502 GitHub request failed'));

      renderCard();

      await screen.findByText("Couldn't load PR counts.");
      expect(menuTrigger()).toBeInTheDocument();
    });

    it('shows the ⋯ in a quiet week', async () => {
      mockGetPrRatio.mockResolvedValue({
        ...RATIO,
        total: 0,
        repos: RATIO.repos.map((repo) => ({ ...repo, count: 0, percentage: 0 })),
      });

      renderCard();

      await screen.findByText('No PRs merged in the last 7 days.');
      expect(menuTrigger()).toBeInTheDocument();
    });

    it('shows the ⋯ beside the bar, after the range', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);

      renderCard();

      const range = await screen.findByText(/Jul 17 – Jul 24/);
      expect(
        range.compareDocumentPosition(menuTrigger()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('lists every project in creation order, ticking each excluded one, under its heading', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      renderCard([REALPLAY, KNOWLEDGE, ALFRED]);
      await screen.findByRole('img');

      const menu = await openMenu();

      expect(within(menu).getByText('Exclude from PR ratio')).toBeInTheDocument();
      const items = within(menu).getAllByRole('menuitemcheckbox');
      expect(items.map((item) => item.textContent)).toEqual(['RealPlay', 'Knowledge', 'Alfred']);
      expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
      ]);
    });

    it('marks each project with its colour dot', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      renderCard([REALPLAY, KNOWLEDGE, ALFRED]);

      const menu = await openMenu();

      const dots = within(menu)
        .getAllByRole('menuitemcheckbox')
        .map(
          (item) => item.querySelector('span[aria-hidden="true"].rounded-full')?.className ?? '',
        );
      expect(dots[0]).toContain('bg-accent-blue');
      expect(dots[1]).toContain('bg-accent-amber');
      expect(dots[2]).toContain('bg-accent-green');
    });

    it('leaves every other project’s colour as it was when one is excluded', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);

      // Knowledge still holds slot #2, so Alfred stays green (#3) rather than taking amber.
      renderCard([REALPLAY, KNOWLEDGE, ALFRED]);

      await screen.findByRole('img');
      expect(legendDot('RealPlay')).toHaveClass('bg-accent-blue');
      expect(legendDot('Alfred')).toHaveClass('bg-accent-green');
      expect(barFills()).toEqual(['bg-accent-blue', 'bg-accent-green']);
    });

    it('saves the negated flag on a tick, keeps the menu open, and refetches once it lands', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      const patch = deferred<Project>();
      mockUpdateProject.mockReturnValue(patch.promise);
      renderCard();
      await screen.findByRole('img');
      const menu = await openMenu();

      await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'RealPlay' }));

      expect(mockUpdateProject).toHaveBeenCalledWith('p-realplay', { exclude_from_pr_ratio: true });
      // Ticked at once, and still open for the next pick.
      expect(screen.getByRole('menuitemcheckbox', { name: 'RealPlay' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      // Not refetched yet: the server reads the flag from the database, so asking before the
      // PATCH lands would race it.
      expect(mockGetPrRatio).toHaveBeenCalledTimes(1);

      patch.resolve({ ...REALPLAY, exclude_from_pr_ratio: true });
      await waitFor(() => {
        expect(mockGetPrRatio).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('unticks an excluded project with the negation too', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      mockUpdateProject.mockResolvedValue({ ...KNOWLEDGE, exclude_from_pr_ratio: false });
      renderCard([REALPLAY, KNOWLEDGE, ALFRED]);
      const menu = await openMenu();

      await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Knowledge' }));

      expect(mockUpdateProject).toHaveBeenCalledWith('p-knowledge', {
        exclude_from_pr_ratio: false,
      });
    });

    it('rolls the tick back, and leaves the ratio alone, when the save fails', async () => {
      mockGetPrRatio.mockResolvedValue(RATIO);
      mockUpdateProject.mockRejectedValue(new Error('patch failed'));
      renderCard();
      await screen.findByRole('img');
      const menu = await openMenu();

      await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Alfred' }));

      await waitFor(() => {
        expect(screen.getByRole('menuitemcheckbox', { name: 'Alfred' })).toHaveAttribute(
          'aria-checked',
          'false',
        );
      });
      expect(await screen.findByText("Couldn't save the PR ratio exclusion")).toBeInTheDocument();
      expect(mockGetPrRatio).toHaveBeenCalledTimes(1);
    });

    describe('with every project excluded', () => {
      const LINE = 'All projects excluded from the PR ratio.';

      it('says so in place of the range, bar and legend — even while the counts load', () => {
        mockGetPrRatio.mockReturnValue(pending());

        const { slot } = renderCard(ALL_EXCLUDED);

        expect(screen.getByText(LINE)).toBeInTheDocument();
        expect(screen.getByText('PRs merged in the last 7 days')).toBeInTheDocument();
        expect(menuTrigger()).toBeInTheDocument();
        // No loading pulse: the store alone decides this state.
        expect(slot.querySelector('.animate-pulse')).toBeNull();
      });

      it('never draws an Other-only bar, even when Other merged PRs', async () => {
        mockGetPrRatio.mockResolvedValue({
          ...RATIO,
          total: 3,
          repos: [],
          other: { count: 3, percentage: 100 },
        });

        renderCard(ALL_EXCLUDED);

        await waitFor(() => {
          expect(mockGetPrRatio).toHaveBeenCalled();
        });
        expect(await screen.findByText(LINE)).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
        expect(screen.queryByText(/Jul 17/)).not.toBeInTheDocument();
        expect(screen.queryByText(/total/)).not.toBeInTheDocument();
      });

      it('wins over the error line too', async () => {
        mockGetPrRatio.mockRejectedValue(new Error('502'));

        renderCard(ALL_EXCLUDED);

        expect(await screen.findByText(LINE)).toBeInTheDocument();
        expect(screen.queryByText("Couldn't load PR counts.")).not.toBeInTheDocument();
      });

      it('brings the bar back when one project is unticked', async () => {
        mockGetPrRatio.mockResolvedValueOnce({ ...RATIO, total: 0, repos: [] });
        mockGetPrRatio.mockResolvedValueOnce({
          ...RATIO,
          total: 6,
          repos: [{ repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 100 }],
        });
        mockUpdateProject.mockResolvedValue({ ...ALFRED, exclude_from_pr_ratio: false });
        renderCard(ALL_EXCLUDED);
        const menu = await openMenu();

        await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Alfred' }));
        await userEvent.keyboard('{Escape}');

        expect(await screen.findByRole('img')).toBeInTheDocument();
        expect(screen.queryByText(LINE)).not.toBeInTheDocument();
      });

      it('waits for the new split after an untick, never drawing the stale Other-only answer', async () => {
        mockGetPrRatio.mockResolvedValueOnce({
          ...RATIO,
          total: 3,
          repos: [],
          other: { count: 3, percentage: 100 },
        });
        mockUpdateProject.mockReturnValue(deferred<Project>().promise);
        const { slot } = renderCard(ALL_EXCLUDED);
        await waitFor(() => {
          expect(mockGetPrRatio).toHaveBeenCalled();
        });
        const menu = await openMenu();

        await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Alfred' }));

        // The answer in hand counted no project; the card pulses until one that does lands.
        expect(screen.queryByText(LINE)).not.toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.queryByText('No PRs merged in the last 7 days.')).not.toBeInTheDocument();
        expect(screen.queryByText(/total/)).not.toBeInTheDocument();
        expect(slot.querySelector('.animate-pulse')).not.toBeNull();
      });

      it('is not claimed for a lone project — one project is no ratio at all', async () => {
        mockGetPrRatio.mockResolvedValue(undefined);

        const { slot } = renderCard([{ ...ALFRED, exclude_from_pr_ratio: true }]);

        expect(screen.queryByText(LINE)).not.toBeInTheDocument();
        await waitFor(() => {
          expect(slot).toBeEmptyDOMElement();
        });
      });
    });
  });
});
