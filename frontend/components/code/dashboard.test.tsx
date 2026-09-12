import { screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { CodeFactoryState, CodeStory, Project } from '@/lib/types';

import { Dashboard } from './dashboard';

// Both GitHub widgets fetch through the api-client seam; these cases are about the composition,
// so answer "not configured here" and let them render nothing, as they do in local dev.
jest.mock('@/lib/api-client');
const mockGetPrRatio = jest.mocked(api.getPrRatio);
const mockGetLocVelocity = jest.mocked(api.getLocVelocity);

// The realtime channel the CodeProvider subscribes — stub it so the provider mounts.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel: () => Promise.resolve('ok') };
  },
}));

const PROJECT: Project = {
  description: null,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 9,
  created_at: '2025-01-01T00:00:00Z',
};

function makeStory(index: number, state: CodeFactoryState, priority: number): CodeStory {
  return {
    item_id: `i${String(index)}`,
    project_id: 'p1',
    epic_id: null,
    ref_number: index,
    ref: `ALF-${String(index)}`,
    factory_state: state,
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
    title: `Story ${String(index)}`,
    notes: null,
    priority,
    item_created_at: '2025-01-01T00:00:00Z',
    project_name: 'Alfred',
    project_key: 'ALF',
    epic_name: null,
    epic_ref: null,
    epic_archived_at: null,
    epic_spec_path: null,
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    source_url: null,
  };
}

/**
 * Render and let both GitHub fetches settle before asserting — every case here is about the
 * composition, and an assertion racing those promises leaves React mid-update.
 */
async function renderDashboard(stories: CodeStory[]) {
  const result = renderWithProviders(<Dashboard />, { projects: [PROJECT], stories });
  await waitFor(() => {
    expect(mockGetPrRatio).toHaveBeenCalled();
    expect(mockGetLocVelocity).toHaveBeenCalled();
  });
  return result;
}

/** The digest pane whose header link carries `name` — each pane is one `SurfaceCard`. */
function pane(name: RegExp): HTMLElement {
  const header = screen.getByRole('link', { name });
  const card = header.parentElement;
  if (card === null) throw new Error('pane header has no card');
  return card;
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockGetPrRatio.mockResolvedValue(undefined);
    mockGetLocVelocity.mockResolvedValue({ status: 'unconfigured' });
  });

  it('carries the module’s hero name and says what the view is for', async () => {
    await renderDashboard([]);

    expect(screen.getByRole('heading', { name: 'The Software Factory' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your code module at a glance — what you're shipping, and what's waiting on you.",
      ),
    ).toBeInTheDocument();
  });

  it('wears the Code teal on its heading glyph, not the Tasks accent (ALF-219)', async () => {
    const { container } = await renderDashboard([]);

    expect(container.querySelector('.text-accent-teal')).toBeInTheDocument();
    expect(container.querySelector('.text-accent-amber')).not.toBeInTheDocument();
  });

  it('digests both queues, each header linking to its full page', async () => {
    await renderDashboard([]);

    expect(screen.getByRole('link', { name: /needs human action/i })).toHaveAttribute(
      'href',
      '/code/needs-human-action',
    );
    expect(screen.getByRole('link', { name: /backlog/i })).toHaveAttribute('href', '/code/backlog');
  });

  it('lists a story awaiting review in BOTH panes rather than deduplicating it', async () => {
    // The Backlog's states are a superset of Needs human action's, so an overlap is honest.
    await renderDashboard([makeStory(1, 'ready_for_review', 1), makeStory(2, 'in_development', 2)]);

    expect(within(pane(/needs human action/i)).getByText('ALF-1')).toBeInTheDocument();
    expect(within(pane(/backlog/i)).getByText('ALF-1')).toBeInTheDocument();
    // …and the Backlog alone carries the story no human is waiting on.
    expect(within(pane(/backlog/i)).getByText('ALF-2')).toBeInTheDocument();
    expect(within(pane(/needs human action/i)).queryByText('ALF-2')).not.toBeInTheDocument();
  });

  it('stacks the panes at base width and sets them side by side from md', async () => {
    await renderDashboard([]);

    const grid = pane(/needs human action/i).parentElement;
    expect(grid).toHaveClass('grid-cols-1', 'md:grid-cols-2');
  });

  it('renders neither GitHub card on a deployment that measures no repos', async () => {
    await renderDashboard([]);

    expect(screen.queryByText('Lines changed per week')).not.toBeInTheDocument();
    expect(screen.queryByText('PRs merged in the last 7 days')).not.toBeInTheDocument();
  });
});
