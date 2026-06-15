import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeProvider } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { Board } from './board';

// The board now mounts the detail modal, which statically imports react-markdown (pure ESM,
// not transformed by jest). Mock the seam so the module loads. (See story-detail-modal.test.)
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

// The epic-header archive/notes controls go through the store's updateEpic → api-client.
jest.mock('@/lib/api-client');
const mockUpdateEpic = jest.mocked(api.updateEpic);

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

  describe('the detail modal (§10)', () => {
    it('opens the modal for the clicked story card', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-7', title: 'Open me' })],
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /open ALF-7/i }));

      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByText('ALF-7')).toBeInTheDocument();
      expect(dialog.getByText('Open me')).toBeInTheDocument();
    });
  });

  describe('the epic header controls (§9.2)', () => {
    it('edits the epic notes via updateEpic', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { notes: 'New notes' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      await user.click(screen.getByRole('button', { name: /add epic notes/i }));
      await user.type(screen.getByRole('textbox', { name: /edit epic notes/i }), 'New notes');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { notes: 'New notes' });
    });

    it('archives an epic via updateEpic (sets archived_at)', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { archived_at: '2026-02-01T00:00:00Z' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      await user.click(screen.getByRole('button', { name: /^archive$/i }));

      await waitFor(() => {
        expect(mockUpdateEpic).toHaveBeenCalledTimes(1);
      });
      const [id, patch] = mockUpdateEpic.mock.calls[0] ?? [];
      expect(id).toBe('e1');
      expect((patch as { archived_at?: string | null }).archived_at).toEqual(expect.any(String));
    });

    it('un-archives an archived epic via updateEpic (clears archived_at)', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { archived_at: null }));
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1', { name: 'Old epic', archived_at: '2026-01-01T00:00:00Z' })],
      });

      // Reveal the archived epic, expand it, then un-archive from its header.
      await user.click(screen.getByRole('button', { name: /show archived/i }));
      await user.click(screen.getByRole('button', { name: /^un-archive$/i }));

      expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { archived_at: null });
    });
  });
});
