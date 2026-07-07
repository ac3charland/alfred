import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import { Backlog } from './backlog';

// The chevron reorder/move goes through the store → api-client; mock the seam.
jest.mock('@/lib/api-client');
const mockReorderCode = jest.mocked(api.reorderCode);
const mockMoveCode = jest.mocked(api.moveCode);
const mockMoveCodeInProject = jest.mocked(api.moveCodeInProject);

// The realtime channel the CodeProvider subscribes — stub it so the provider mounts.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel: () => Promise.resolve('ok') };
  },
}));

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 5,
  created_at: '2025-01-01T00:00:00Z',
};

const EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Refinement',
  notes: null,
  ref_number: 3,
  ref: 'ALF-3',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
};

const PROJECT_2: Project = {
  ...PROJECT,
  id: 'p2',
  key: 'RLP',
  name: 'Relay',
  repo_name: 'relay',
};

const EPIC_2: Epic = {
  ...EPIC,
  id: 'e2',
  project_id: 'p2',
  ref: 'RLP-1',
};

function makeStory(itemId: string, overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: `ALF-${itemId}`,
    factory_state: 'in_development',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
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
    factory_state: 'in_development',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    priority,
  };
}

/** The current row order, read from the per-row "Move <ref> up" chevron labels. */
function rowOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /Move .+ up/ })
    .map((button) => /Move (\S+) up/.exec(button.getAttribute('aria-label') ?? '')?.[1] ?? '');
}

function renderBacklog(stories: CodeStory[], seed: { projects?: Project[]; epics?: Epic[] } = {}) {
  return renderWithProviders(<Backlog />, {
    projects: seed.projects ?? [PROJECT],
    epics: seed.epics ?? [EPIC],
    stories,
  });
}

/**
 * p1 has two stories (a, c); p2 has one (other) ranked between them, so the project-scoped
 * chevron must not disturb — or be blocked by — the other project's story.
 */
function seedTwoProjects() {
  return renderBacklog(
    [
      makeStory('a', { priority: 10 }),
      makeStory('other', { priority: 20, project_id: 'p2', epic_id: 'e2', ref: 'RLP-1' }),
      makeStory('c', { priority: 30 }),
    ],
    { projects: [PROJECT, PROJECT_2], epics: [EPIC, EPIC_2] },
  );
}

describe('Backlog', () => {
  beforeEach(() => {
    mockReorderCode.mockReset();
    mockMoveCode.mockReset();
    mockMoveCodeInProject.mockReset();
  });

  it('renders the header hero and a Filter by status control', () => {
    renderBacklog([makeStory('a', { priority: 1 })]);
    expect(screen.getByText('The Software Factory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /filter by status/i })).toBeInTheDocument();
  });

  it('shows a count on the trigger only when the selection differs from the default', async () => {
    const user = userEvent.setup();
    renderBacklog([
      makeStory('a', { priority: 10, factory_state: 'needs_refinement' }),
      makeStory('b', { priority: 20, factory_state: 'in_development' }),
    ]);
    // The default selection (done/abandoned hidden) is the resting state — no count.
    expect(screen.getByRole('button', { name: 'Filter by status' })).toBeInTheDocument();

    // Uncheck one default status; the selection now differs from the default → a count appears.
    // The first menu item is the "Human Review" macro, so "Needs Refinement" is the 2nd item.
    await user.click(screen.getByRole('button', { name: 'Filter by status' }));
    await screen.findByRole('menu');
    await user.keyboard('[ArrowDown][ArrowDown][Enter]');
    await user.keyboard('[Escape]');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /filter by status \(\d+\)/i })).toBeInTheDocument();
    });
  });

  it('lists stories in priority order with a status chip on every row', () => {
    renderBacklog([
      makeStory('a', { priority: 30 }),
      makeStory('b', { priority: 10 }),
      makeStory('c', { priority: 20 }),
    ]);
    expect(rowOrder()).toEqual(['ALF-b', 'ALF-c', 'ALF-a']);
    // The status is labelled for the happy-path state, not just blocked/abandoned.
    expect(screen.getAllByText('In Development')).toHaveLength(3);
  });

  it('hides done/abandoned by default and reveals Done when its status is checked', async () => {
    const user = userEvent.setup();
    renderBacklog([
      makeStory('a', { priority: 10, factory_state: 'in_development' }),
      makeStory('b', { priority: 20, factory_state: 'done' }),
      makeStory('c', { priority: 30, factory_state: 'abandoned' }),
    ]);
    expect(rowOrder()).toEqual(['ALF-a']);

    // Open the multi-select status filter. Radix portals set pointer-events:none on the body, so
    // drive the menu by keyboard (see folder-nav.test.tsx). The first item is the "Human Review"
    // macro, then the options follow ALL_FACTORY_STATES order, so "Done" is the 7th item; toggling
    // it on reveals the done story (priority order kept).
    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Done' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await user.keyboard(
      '[ArrowDown][ArrowDown][ArrowDown][ArrowDown][ArrowDown][ArrowDown][ArrowDown][Enter]',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Done' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // The open menu marks the rows aria-hidden, so close it before reading the row order.
    await user.keyboard('[Escape]');
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-a', 'ALF-b']);
    });
    // Abandoned was never checked, so its story stays hidden.
    expect(rowOrder()).not.toContain('ALF-c');
  });

  it('narrows the list to a single status when the defaults are unchecked', async () => {
    const user = userEvent.setup();
    renderBacklog([
      makeStory('a', { priority: 10, factory_state: 'needs_refinement' }),
      makeStory('b', { priority: 20, factory_state: 'in_development' }),
    ]);
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b']);

    // Uncheck "Needs Refinement" (the 2nd item, after the "Human Review" macro) — only the
    // in_development row stays.
    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');
    await user.keyboard('[ArrowDown][ArrowDown][Enter]');
    // Close the menu (it aria-hides the rows while open), then read the narrowed order.
    await user.keyboard('[Escape]');
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-b']);
    });
  });

  it('the Human Review macro narrows to In Refinement, Ready for Dev, and Ready for Review', async () => {
    const user = userEvent.setup();
    renderBacklog([
      makeStory('a', { priority: 10, factory_state: 'needs_refinement' }),
      makeStory('b', { priority: 20, factory_state: 'in_refinement' }),
      makeStory('c', { priority: 30, factory_state: 'ready_for_dev' }),
      makeStory('d', { priority: 40, factory_state: 'ready_for_review' }),
      makeStory('e', { priority: 50, factory_state: 'in_development' }),
    ]);
    // Default (outstanding) selection lists every open story.
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b', 'ALF-c', 'ALF-d', 'ALF-e']);

    // "Human Review" is the first menu item — checking it narrows to exactly its three states.
    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Human Review' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await user.keyboard('[ArrowDown][Enter]');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Human Review' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.keyboard('[Escape]');
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-b', 'ALF-c', 'ALF-d']);
    });
  });

  it('unchecks the Human Review macro when another status is toggled', async () => {
    const user = userEvent.setup();
    renderBacklog([makeStory('a', { priority: 10, factory_state: 'in_refinement' })]);

    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');
    // Turn the macro on, then check "Needs Refinement" (the next focusable item, past the divider).
    await user.keyboard('[ArrowDown][Enter]');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Human Review' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.keyboard('[ArrowDown][Enter]');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Needs Refinement' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The selection no longer matches the preset, so the macro unchecks itself.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Human Review' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('disables Up on the first row and Down on the last', () => {
    renderBacklog([makeStory('a', { priority: 1 }), makeStory('b', { priority: 2 })]);
    expect(screen.getByRole('button', { name: 'Move ALF-a up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-b down' })).toBeDisabled();
    // The middle of the boundary stays operable.
    expect(screen.getByRole('button', { name: 'Move ALF-a down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move ALF-b up' })).toBeEnabled();
  });

  it('reorders via the chevron: Up on the 2nd row swaps with the 1st and re-sorts', async () => {
    const user = userEvent.setup();
    mockReorderCode.mockResolvedValue([makeSidecar('a', 2), makeSidecar('b', 1)]);
    renderBacklog([makeStory('a', { priority: 1 }), makeStory('b', { priority: 2 })]);
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b']);

    await user.click(screen.getByRole('button', { name: 'Move ALF-b up' }));

    expect(mockReorderCode).toHaveBeenCalledWith('ALF-b', 'ALF-a');
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-b', 'ALF-a']);
    });
  });

  it('disables to-top-of-list on the first row and to-bottom-of-list on the last', () => {
    renderBacklog([makeStory('a', { priority: 1 }), makeStory('b', { priority: 2 })]);
    expect(screen.getByRole('button', { name: 'Move ALF-a to top of list' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-b to bottom of list' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-a to bottom of list' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move ALF-b to top of list' })).toBeEnabled();
  });

  it('jumps to the top of the whole Backlog via the arrow-to-line icon: last row moves above the rest', async () => {
    const user = userEvent.setup();
    mockMoveCode.mockResolvedValue([makeSidecar('c', -1)]);
    renderBacklog([
      makeStory('a', { priority: 10 }),
      makeStory('b', { priority: 20 }),
      makeStory('c', { priority: 30 }),
    ]);
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b', 'ALF-c']);

    await user.click(screen.getByRole('button', { name: 'Move ALF-c to top of list' }));

    expect(mockMoveCode).toHaveBeenCalledWith('ALF-c', true);
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-c', 'ALF-a', 'ALF-b']);
    });
  });

  it('jumps to the bottom of the whole Backlog via the arrow-to-line icon: first row moves below the rest', async () => {
    const user = userEvent.setup();
    mockMoveCode.mockResolvedValue([makeSidecar('a', 31)]);
    renderBacklog([
      makeStory('a', { priority: 10 }),
      makeStory('b', { priority: 20 }),
      makeStory('c', { priority: 30 }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Move ALF-a to bottom of list' }));

    expect(mockMoveCode).toHaveBeenCalledWith('ALF-a', false);
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-b', 'ALF-c', 'ALF-a']);
    });
  });

  describe('to top/bottom of project (ALF-110, the repurposed double chevron)', () => {
    it('disables to-top-of-project/to-bottom-of-project once a story already holds that slot', () => {
      seedTwoProjects();
      // a is p1's only-better story, c is p1's only-worse story — each already holds its slot.
      expect(screen.getByRole('button', { name: 'Move ALF-a to top of project' })).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Move ALF-c to bottom of project' }),
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move ALF-c to top of project' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Move ALF-a to bottom of project' })).toBeEnabled();
    });

    it('jumps to the top of its project via the double-up chevron, calling moveCodeInProject', async () => {
      const user = userEvent.setup();
      mockMoveCodeInProject.mockResolvedValue([makeSidecar('c', 5)]);
      seedTwoProjects();

      await user.click(screen.getByRole('button', { name: 'Move ALF-c to top of project' }));

      expect(mockMoveCodeInProject).toHaveBeenCalledWith('ALF-c', true);
      expect(mockMoveCode).not.toHaveBeenCalled();
      // c (now priority 5) outranks a (10) but the other project's story (20) stays put.
      await waitFor(() => {
        expect(rowOrder()).toEqual(['ALF-c', 'ALF-a', 'RLP-1']);
      });
    });

    it('jumps to the bottom of its project via the double-down chevron, calling moveCodeInProject', async () => {
      const user = userEvent.setup();
      mockMoveCodeInProject.mockResolvedValue([makeSidecar('a', 25)]);
      seedTwoProjects();

      await user.click(screen.getByRole('button', { name: 'Move ALF-a to bottom of project' }));

      expect(mockMoveCodeInProject).toHaveBeenCalledWith('ALF-a', false);
      expect(mockMoveCode).not.toHaveBeenCalled();
      // a (now priority 25) ranks worse than c's old top spot but still better than c (30) —
      // and the other project's story (20) stays put.
      await waitFor(() => {
        expect(rowOrder()).toEqual(['RLP-1', 'ALF-a', 'ALF-c']);
      });
    });
  });

  it('shows the empty state when there are no stories', () => {
    renderBacklog([]);
    expect(screen.getByText(/No stories yet/)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('the row body deep-links to the story modal on its board', () => {
    renderBacklog([makeStory('a', { priority: 1 })]);
    const link = screen.getByRole('link', { name: /Open ALF-a/ });
    expect(link).toHaveAttribute('href', '/code/p1?story=ALF-a');
    // Sanity: the chevrons are siblings of the link, not nested inside it (no nested interactive).
    expect(within(link).queryByRole('button')).not.toBeInTheDocument();
  });
});
