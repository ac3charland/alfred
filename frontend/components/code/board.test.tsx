import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { Board } from './board';

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 9,
  created_at: '2025-01-01T00:00:00Z',
};

function makeEpic(id: string, overrides: Partial<Epic> = {}): Epic {
  return {
    id,
    project_id: 'p1',
    name: `Epic ${id}`,
    notes: null,
    ref_number: 1,
    ref: `ALF-${id}`,
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStory(itemId: string, epicId: string, overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: itemId,
    project_id: 'p1',
    epic_id: epicId,
    ref_number: 1,
    ref: `ALF-${itemId}`,
    factory_state: 'needs_refinement',
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
    epic_name: `Epic ${epicId}`,
    epic_ref: `ALF-${epicId}`,
    epic_archived_at: null,
    ...overrides,
  };
}

function renderBoard(seed: {
  projects?: Project[];
  epics?: Epic[];
  stories?: CodeStory[];
  projectId?: string;
}) {
  return render(
    <CodeProvider
      initialProjects={seed.projects ?? [PROJECT]}
      initialEpics={seed.epics ?? []}
      initialStories={seed.stories ?? []}
    >
      <Board projectId={seed.projectId ?? 'p1'} />
    </CodeProvider>,
  );
}

describe('Board', () => {
  it('shows the project name and key in the header', () => {
    renderBoard({ epics: [makeEpic('e1')] });

    expect(screen.getByRole('heading', { name: 'Alfred' })).toBeInTheDocument();
    expect(screen.getByText('ALF')).toBeInTheDocument();
  });

  it('renders a not-found message for an unknown project id', () => {
    renderBoard({ projectId: 'nope' });

    expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
  });

  it('shows an empty state when the project has no epics', () => {
    renderBoard({ epics: [] });

    expect(screen.getByText(/no epics yet/i)).toBeInTheDocument();
  });

  it('renders an epic header with its name and ref', () => {
    renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing', ref: 'ALF-3' })] });

    expect(screen.getByRole('button', { name: /plumbing/i })).toBeInTheDocument();
    expect(screen.getByText('ALF-3')).toBeInTheDocument();
  });

  it('renders the six happy-path swimlanes for an expanded epic', () => {
    renderBoard({ epics: [makeEpic('e1')] });

    for (const label of [
      'Needs Refinement',
      'In Refinement',
      'Ready for Dev',
      'In Development',
      'Ready for Review',
      'Done',
    ]) {
      expect(screen.getByRole('region', { name: label })).toBeInTheDocument();
    }
  });

  it('places a story card (ref + title) in the swimlane matching its state', () => {
    renderBoard({
      epics: [makeEpic('e1')],
      stories: [makeStory('i1', 'e1', { ref: 'ALF-7', factory_state: 'in_development' })],
    });

    const lane = screen.getByRole('region', { name: 'In Development' });
    expect(within(lane).getByText('ALF-7')).toBeInTheDocument();
    expect(within(lane).getByText('Story i1')).toBeInTheDocument();

    // It is NOT in the Needs Refinement lane.
    const other = screen.getByRole('region', { name: 'Needs Refinement' });
    expect(within(other).queryByText('ALF-7')).not.toBeInTheDocument();
  });

  it('collapses and re-expands an epic via its header toggle', async () => {
    const user = userEvent.setup();
    renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

    const header = screen.getByRole('button', { name: /plumbing/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Needs Refinement' })).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Needs Refinement' })).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Needs Refinement' })).toBeInTheDocument();
  });

  it('tracks collapsed state per epic (collapsing one leaves the other open)', async () => {
    const user = userEvent.setup();
    renderBoard({ epics: [makeEpic('e1', { name: 'Alpha' }), makeEpic('e2', { name: 'Beta' })] });

    await user.click(screen.getByRole('button', { name: /alpha/i }));

    expect(screen.getByRole('button', { name: /alpha/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Beta stays open and still shows its swimlanes.
    expect(screen.getByRole('button', { name: /beta/i })).toHaveAttribute('aria-expanded', 'true');
    // Beta's lanes are still present (one region per state per open epic).
    expect(screen.getAllByRole('region', { name: 'Needs Refinement' })).toHaveLength(1);
  });

  it('hides archived epics by default and reveals them with Show archived', async () => {
    const user = userEvent.setup();
    renderBoard({
      epics: [
        makeEpic('e1', { name: 'Active epic' }),
        makeEpic('e2', { name: 'Old epic', archived_at: '2025-02-01T00:00:00Z' }),
      ],
    });

    expect(screen.queryByRole('button', { name: /old epic/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show archived/i }));

    expect(screen.getByRole('button', { name: /old epic/i })).toBeInTheDocument();
  });

  it('does not offer Show archived when no epic is archived', () => {
    renderBoard({ epics: [makeEpic('e1')] });

    expect(screen.queryByRole('button', { name: /show archived/i })).not.toBeInTheDocument();
  });

  it('hides blocked/abandoned stories until the blocked filter is toggled on', async () => {
    const user = userEvent.setup();
    renderBoard({
      epics: [makeEpic('e1')],
      stories: [makeStory('i1', 'e1', { ref: 'ALF-blocked', factory_state: 'blocked' })],
    });

    // The blocked story isn't shown by default, and never as a swimlane.
    expect(screen.queryByText('ALF-blocked')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show blocked/i }));

    expect(screen.getByText('ALF-blocked')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    // Still no "blocked"/"abandoned" swimlane region exists.
    expect(screen.queryByRole('region', { name: /^blocked$/i })).not.toBeInTheDocument();
  });
});
