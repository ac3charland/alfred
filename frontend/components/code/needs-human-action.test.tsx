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
    factory_state: 'ready_for_dev',
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
    factory_state: 'ready_for_dev',
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

function renderView(stories: CodeStory[]) {
  return renderWithProviders(<NeedsHumanAction />, {
    projects: [PROJECT],
    epics: [EPIC],
    stories,
  });
}

describe('NeedsHumanAction', () => {
  beforeEach(() => {
    mockReorderCode.mockReset();
  });

  it('renders its own header and no Filter by status control', () => {
    renderView([makeStory('a')]);
    expect(screen.getByRole('heading', { name: 'Needs human action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /filter by status/i })).not.toBeInTheDocument();
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
});
