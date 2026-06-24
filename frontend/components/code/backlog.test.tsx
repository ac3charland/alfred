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

function renderBacklog(stories: CodeStory[]) {
  return renderWithProviders(<Backlog />, { projects: [PROJECT], epics: [EPIC], stories });
}

describe('Backlog', () => {
  beforeEach(() => {
    mockReorderCode.mockReset();
    mockMoveCode.mockReset();
  });

  it('renders the header hero and a Show completed toggle', () => {
    renderBacklog([makeStory('a', { priority: 1 })]);
    expect(screen.getByText('The Software Factory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show completed' })).toBeInTheDocument();
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

  it('hides done/abandoned until Show completed is toggled on', async () => {
    const user = userEvent.setup();
    renderBacklog([
      makeStory('a', { priority: 10, factory_state: 'in_development' }),
      makeStory('b', { priority: 20, factory_state: 'done' }),
      makeStory('c', { priority: 30, factory_state: 'abandoned' }),
    ]);
    expect(rowOrder()).toEqual(['ALF-a']);

    await user.click(screen.getByRole('button', { name: 'Show completed' }));
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b', 'ALF-c']);

    await user.click(screen.getByRole('button', { name: 'Show completed' }));
    expect(rowOrder()).toEqual(['ALF-a']);
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

  it('disables to-top on the first row and to-bottom on the last', () => {
    renderBacklog([makeStory('a', { priority: 1 }), makeStory('b', { priority: 2 })]);
    expect(screen.getByRole('button', { name: 'Move ALF-a to top' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-b to bottom' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-a to bottom' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move ALF-b to top' })).toBeEnabled();
  });

  it('jumps to the top via the double chevron: last row moves above the rest and re-sorts', async () => {
    const user = userEvent.setup();
    mockMoveCode.mockResolvedValue([makeSidecar('c', -1)]);
    renderBacklog([
      makeStory('a', { priority: 10 }),
      makeStory('b', { priority: 20 }),
      makeStory('c', { priority: 30 }),
    ]);
    expect(rowOrder()).toEqual(['ALF-a', 'ALF-b', 'ALF-c']);

    await user.click(screen.getByRole('button', { name: 'Move ALF-c to top' }));

    expect(mockMoveCode).toHaveBeenCalledWith('ALF-c', true);
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-c', 'ALF-a', 'ALF-b']);
    });
  });

  it('jumps to the bottom via the double chevron: first row moves below the rest and re-sorts', async () => {
    const user = userEvent.setup();
    mockMoveCode.mockResolvedValue([makeSidecar('a', 31)]);
    renderBacklog([
      makeStory('a', { priority: 10 }),
      makeStory('b', { priority: 20 }),
      makeStory('c', { priority: 30 }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Move ALF-a to bottom' }));

    expect(mockMoveCode).toHaveBeenCalledWith('ALF-a', false);
    await waitFor(() => {
      expect(rowOrder()).toEqual(['ALF-b', 'ALF-c', 'ALF-a']);
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
