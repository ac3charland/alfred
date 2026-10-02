import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import { NeedsHumanAction } from './needs-human-action';

// The chevron reorder goes through the store → api-client; mock the seam.
jest.mock('@/lib/api-client');
const mockReorderCode = jest.mocked(api.reorderCode);

// The realtime channel the CodeProvider subscribes — stub it so the provider mounts.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return {
      realtime: { setAuth: () => Promise.resolve() },
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
    };
  },
}));

const PROJECT: Project = {
  color: null,
  description: null,
  exclude_from_pr_ratio: false,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 5,
  created_at: '2025-01-01T00:00:00Z',
};

const PROJECT_2: Project = {
  ...PROJECT,
  id: 'p2',
  key: 'RLP',
  name: 'Relay',
  repo_name: 'relay',
};

const EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Refinement',
  notes: null,
  ref_number: 3,
  ref: 'ALF-3',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};

function makeStory(itemId: string, overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: `ALF-${itemId}`,
    factory_state: 'ready_for_dev',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: true,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: `Story ${itemId}`,
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Refinement',
    epic_ref: 'ALF-3',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

function makeSidecar(itemId: string, priority: number): CodeItem {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: `ALF-${itemId}`,
    factory_state: 'ready_for_dev',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: true,
    created_at: '2025-01-01T00:00:00Z',
    done_at: null,
    updated_at: '2025-01-02T00:00:00Z',
    priority,
    priority_rev: 0,
  };
}

/** The current row order, read from the per-row "Move <ref> up" chevron labels. */
function rowOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /Move .+ up/ })
    .map((button) => /Move (\S+) up/.exec(button.getAttribute('aria-label') ?? '')?.[1] ?? '');
}

const EPIC_2: Epic = { ...EPIC, id: 'e2', project_id: 'p2', ref: 'RLP-1' };

function renderView(stories: CodeStory[], seed: { projects?: Project[]; epics?: Epic[] } = {}) {
  return renderWithProviders(<NeedsHumanAction />, {
    projects: seed.projects ?? [PROJECT],
    epics: seed.epics ?? [EPIC],
    stories,
  });
}

/** A Relay story, so the project filter has a second project to tell apart. */
function relayStory(itemId: string, overrides: Partial<CodeStory> = {}): CodeStory {
  return makeStory(itemId, {
    project_id: 'p2',
    epic_id: 'e2',
    ref: `RLP-${itemId}`,
    project_key: 'RLP',
    project_name: 'Relay',
    repo_name: 'relay',
    epic_ref: 'RLP-1',
    ...overrides,
  });
}

/** Two projects, one story per human-review state, interleaved in the global ranking. */
function seedTwoProjects() {
  return renderView(
    [
      makeStory('a', { priority: 10, factory_state: 'in_refinement' }),
      relayStory('b', { priority: 20, factory_state: 'ready_for_dev' }),
      makeStory('c', { priority: 30, factory_state: 'ready_for_review' }),
      relayStory('d', { priority: 40, factory_state: 'in_refinement' }),
    ],
    { projects: [PROJECT, PROJECT_2], epics: [EPIC, EPIC_2] },
  );
}

/**
 * Open the named filter menu and toggle its `nth` option (1-based menu position), then close it.
 * Radix portals set pointer-events:none on the body, so the menu is driven by keyboard; and while
 * it's open the rows are aria-hidden, so it must be closed before reading them.
 */
async function toggleOption(
  user: ReturnType<typeof userEvent.setup>,
  menu: RegExp,
  nth: number,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: menu }));
  await screen.findByRole('menu');
  await user.keyboard(`${'[ArrowDown]'.repeat(nth)}[Enter]`);
  await user.keyboard('[Escape]');
}

describe('NeedsHumanAction', () => {
  beforeEach(() => {
    mockReorderCode.mockReset();
  });

  it('renders its own header with a Filter by status and a Filter by project control', () => {
    renderView([makeStory('a')]);
    expect(screen.getByRole('heading', { name: 'Needs human action' })).toBeInTheDocument();
    // Both rest at their defaults, so neither trigger carries a count.
    expect(screen.getByRole('button', { name: 'Filter by status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by project' })).toBeInTheDocument();
  });

  it('wears the Code teal on its heading glyph, not the Tasks accent (ALF-219)', () => {
    const { container } = renderView([makeStory('a')]);

    expect(container.querySelector('.text-accent-teal')).toBeInTheDocument();
    expect(container.querySelector('.text-accent-amber')).not.toBeInTheDocument();
  });

  it('lists only the human-review states, hiding every other status, in priority order', () => {
    renderView([
      makeStory('a', { priority: 50, factory_state: 'in_development' }),
      makeStory('b', { priority: 40, factory_state: 'ready_for_review' }),
      makeStory('c', { priority: 10, factory_state: 'in_refinement' }),
      makeStory('d', { priority: 30, factory_state: 'ready_for_dev' }),
      makeStory('e', { priority: 20, factory_state: 'needs_refinement' }),
      makeStory('f', { priority: 60, factory_state: 'done' }),
      makeStory('g', { priority: 70, factory_state: 'blocked' }),
    ]);
    // Only in_refinement / ready_for_dev / ready_for_review survive, ranked by priority.
    expect(rowOrder()).toEqual(['ALF-c', 'ALF-d', 'ALF-b']);
  });

  it('keeps the Backlog reorder controls: Up on the 2nd row swaps with the 1st, INSTANTLY', async () => {
    const user = userEvent.setup();
    mockReorderCode.mockResolvedValue([makeSidecar('a', 2), makeSidecar('b', 1)]);
    renderView([
      makeStory('a', { priority: 1, factory_state: 'ready_for_dev' }),
      makeStory('b', { priority: 2, factory_state: 'ready_for_review' }),
    ]);
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b']);

    await user.click(screen.getByRole('button', { name: 'Move ALF-b up' }));

    // The row re-sorts on screen instantly — no waiting on the network for this.
    expect(rowOrder()).toEqual(['ALF-b', 'ALF-a']);
    await waitFor(() => {
      expect(mockReorderCode).toHaveBeenCalledWith('ALF-b', 'ALF-a');
    });
  });

  it('shows an empty state when nothing awaits a human', () => {
    renderView([makeStory('a', { factory_state: 'in_development' })]);
    expect(screen.getByText(/Nothing needs your attention right now/)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  describe('filter by status (ALF-316)', () => {
    it('offers only the three human-review states, all checked at rest', async () => {
      const user = userEvent.setup();
      seedTwoProjects();

      await user.click(screen.getByRole('button', { name: 'Filter by status' }));
      await screen.findByRole('menu');

      // The view's scope IS these three states — offering `done` or `in_development` here would
      // let the filter widen the queue beyond what needs a human.
      expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
        'In Refinement',
        'Ready for Dev',
        'Ready for Review',
      ]);
      for (const item of screen.getAllByRole('menuitemcheckbox')) {
        expect(item).toHaveAttribute('aria-checked', 'true');
      }
    });

    it('hides a state when it is unchecked and shows a count on the trigger', async () => {
      const user = userEvent.setup();
      seedTwoProjects();
      expect(rowOrder()).toEqual(['ALF-a', 'RLP-b', 'ALF-c', 'RLP-d']);

      // Uncheck "In Refinement" (the 1st option) — its two stories drop out.
      await toggleOption(user, /filter by status/i, 1);

      await waitFor(() => {
        expect(rowOrder()).toEqual(['RLP-b', 'ALF-c']);
      });
      expect(screen.getByRole('button', { name: 'Filter by status (2)' })).toBeInTheDocument();
    });

    it('blames the filters, not the queue, when they hide every waiting story', async () => {
      const user = userEvent.setup();
      seedTwoProjects();

      await toggleOption(user, /filter by status/i, 1);
      await toggleOption(user, /filter by status/i, 2);
      await toggleOption(user, /filter by status/i, 3);

      await waitFor(() => {
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
      });
      // Stories ARE waiting — claiming "nothing needs your attention" would hide them.
      expect(screen.getByText(/No stories match these filters/)).toBeInTheDocument();
      expect(screen.queryByText(/Nothing needs your attention/)).not.toBeInTheDocument();
    });
  });

  describe('filter by project (ALF-316)', () => {
    it('lists every project in creation order, none checked at rest', async () => {
      const user = userEvent.setup();
      seedTwoProjects();

      await user.click(screen.getByRole('button', { name: 'Filter by project' }));
      await screen.findByRole('menu');

      expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
        'Alfred',
        'Relay',
      ]);
      for (const item of screen.getAllByRole('menuitemcheckbox')) {
        expect(item).toHaveAttribute('aria-checked', 'false');
      }
    });

    it('narrows to just the checked project and shows a count on the trigger', async () => {
      const user = userEvent.setup();
      seedTwoProjects();

      await toggleOption(user, /filter by project/i, 2);

      await waitFor(() => {
        expect(rowOrder()).toEqual(['RLP-b', 'RLP-d']);
      });
      expect(screen.getByRole('button', { name: 'Filter by project (1)' })).toBeInTheDocument();
    });

    it('returns to every project when the only checked project is unchecked', async () => {
      const user = userEvent.setup();
      seedTwoProjects();

      await toggleOption(user, /filter by project/i, 2);
      await waitFor(() => {
        expect(rowOrder()).toEqual(['RLP-b', 'RLP-d']);
      });

      await toggleOption(user, /filter by project/i, 2);
      await waitFor(() => {
        expect(rowOrder()).toEqual(['ALF-a', 'RLP-b', 'ALF-c', 'RLP-d']);
      });
      expect(screen.getByRole('button', { name: 'Filter by project' })).toBeInTheDocument();
    });

    it('combines with the status filter', async () => {
      const user = userEvent.setup();
      seedTwoProjects();

      // Relay only, then drop In Refinement: just Relay's Ready for Dev story is left.
      await toggleOption(user, /filter by project/i, 2);
      await toggleOption(user, /filter by status/i, 1);

      await waitFor(() => {
        expect(rowOrder()).toEqual(['RLP-b']);
      });
    });

    it('blames the filters when the picked project has nothing waiting but others do', async () => {
      const user = userEvent.setup();
      // Relay's only story is mid-development, so picking Relay alone empties the queue.
      renderView(
        [
          makeStory('a', { priority: 10, factory_state: 'in_refinement' }),
          relayStory('b', { priority: 20, factory_state: 'in_development' }),
        ],
        { projects: [PROJECT, PROJECT_2], epics: [EPIC, EPIC_2] },
      );

      await toggleOption(user, /filter by project/i, 2);

      await waitFor(() => {
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
      });
      expect(screen.getByText(/No stories match these filters/)).toBeInTheDocument();
      expect(screen.queryByText(/Nothing needs your attention/)).not.toBeInTheDocument();
    });

    it('omits the project control when there are no projects to filter', () => {
      renderView([], { projects: [], epics: [] });
      expect(screen.queryByRole('button', { name: /filter by project/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /filter by status/i })).toBeInTheDocument();
    });

    it('swaps with the VISIBLE neighbour, skipping a story the project filter hides', async () => {
      const user = userEvent.setup();
      mockReorderCode.mockResolvedValue([makeSidecar('a', 30), makeSidecar('c', 10)]);
      seedTwoProjects();

      await toggleOption(user, /filter by project/i, 1);
      await waitFor(() => {
        expect(rowOrder()).toEqual(['ALF-a', 'ALF-c']);
      });

      // ALF-c's visible upper neighbour is ALF-a — the hidden RLP-b between them is skipped.
      await user.click(screen.getByRole('button', { name: 'Move ALF-c up' }));
      await waitFor(() => {
        expect(mockReorderCode).toHaveBeenCalledWith('ALF-c', 'ALF-a');
      });
    });
  });
});
