import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeFilterProvider } from '@/lib/stores/code-filter-store';
import { CodeProvider } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import { Board } from './board';

// The board now mounts the detail modal, which statically imports react-markdown (pure ESM,
// not transformed by jest). Mock the seam so the module loads. (See story-detail-modal.test.)
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

// The board reads a `?story=<ref>` deep-link via useSearchParams; drive it from a test variable.
let mockStoryParam: string | null = null;
jest.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(mockStoryParam === null ? '' : `story=${mockStoryParam}`),
}));

// The epic-header archive/notes controls go through the store's updateEpic → api-client.
jest.mock('@/lib/api-client');
const mockUpdateEpic = jest.mocked(api.updateEpic);
const mockCreateCodeStory = jest.mocked(api.createCodeStory);
const mockCreateEpic = jest.mocked(api.createEpic);

// Capture the realtime UPDATE handler the CodeProvider subscribes, so a test can emit a
// simulated `code_items` change and assert the card moves swimlanes with no user interaction.
// The provider subscribes an `epics` channel too, so key the capture on the filter's table —
// capturing whichever handler registered last would silently hand back the wrong one.
let mockRealtimeHandler: ((payload: { new: CodeItem }) => void) | undefined;
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
        if (filter.table === 'code_items') {
          mockRealtimeHandler = handler as (payload: { new: CodeItem }) => void;
        }
        return channel;
      },
      subscribe: () => channel,
    };
    return { channel: () => channel, removeChannel: () => Promise.resolve('ok') };
  },
}));

beforeEach(() => {
  mockRealtimeHandler = undefined;
  mockStoryParam = null;
});

/** A saved `code_items` sidecar row (the realtime UPDATE payload shape). */
function makeSidecar(overrides: Partial<CodeItem> = {}): CodeItem {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: 'ALF-i1',
    factory_state: 'needs_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    priority: 1,
    ...overrides,
  };
}

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
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
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
    blocked_from: null,
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
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

/** Open the board toolbar's mobile ⋯ filter menu. */
async function openFilterMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Board filters' }));
  return screen.findByRole('menu');
}

/**
 * Dismiss the ⋯ menu (and any open submenu) before asserting on the board. The menu is modal, so
 * while it's open Radix `aria-hidden`s the rest of the tree and every role-based query behind it
 * comes back empty — a closed menu is the only honest place to assert the board's state from.
 */
async function closeFilterMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('[Escape][Escape]');
  await waitFor(() => {
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
}

function renderBoard(seed: {
  projects?: Project[];
  epics?: Epic[];
  stories?: CodeStory[];
  projectId?: string;
}) {
  return render(
    <ToastProvider>
      <CodeProvider
        initialProjects={seed.projects ?? [PROJECT]}
        initialEpics={seed.epics ?? []}
        initialStories={seed.stories ?? []}
      >
        <CodeFilterProvider>
          <Board projectId={seed.projectId ?? 'p1'} />
        </CodeFilterProvider>
      </CodeProvider>
    </ToastProvider>,
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

    expect(screen.getByRole('button', { name: /^plumbing/i })).toBeInTheDocument();
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

    const header = screen.getByRole('button', { name: /^plumbing/i });
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

    await user.click(screen.getByRole('button', { name: /^alpha/i }));

    expect(screen.getByRole('button', { name: /^alpha/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Beta stays open and still shows its swimlanes.
    expect(screen.getByRole('button', { name: /^beta/i })).toHaveAttribute('aria-expanded', 'true');
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

    expect(screen.queryByRole('button', { name: /^old epic/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show archived/i }));

    expect(screen.getByRole('button', { name: /^old epic/i })).toBeInTheDocument();
  });

  it('does not offer Show archived when no epic is archived', () => {
    renderBoard({ epics: [makeEpic('e1')] });

    expect(screen.queryByRole('button', { name: /show archived/i })).not.toBeInTheDocument();
  });

  // ALF-136: the Show-blocked toggle is gone; blocked work is always on the board.
  it('offers no Show blocked toggle', () => {
    renderBoard({ epics: [makeEpic('e1')] });

    expect(screen.queryByRole('button', { name: /show blocked/i })).not.toBeInTheDocument();
  });

  it('shows a blocked story with no toggling, in the lane it was blocked from', () => {
    renderBoard({
      epics: [makeEpic('e1')],
      stories: [
        makeStory('i1', 'e1', {
          ref: 'ALF-blocked',
          factory_state: 'blocked',
          blocked_from: 'in_development',
        }),
      ],
    });

    // Visible immediately, carrying its Blocked treatment, inside the In Development swimlane.
    const lane = screen.getByRole('region', { name: 'In Development' });
    expect(within(lane).getByText('ALF-blocked')).toBeInTheDocument();
    expect(within(lane).getByText('Blocked')).toBeInTheDocument();
    // Blocked still never gets a swimlane of its own.
    expect(screen.queryByRole('region', { name: /^blocked$/i })).not.toBeInTheDocument();
  });

  it('badges the epic header with the number of blocked stories', () => {
    renderBoard({
      epics: [makeEpic('e1')],
      stories: [
        makeStory('i1', 'e1', { ref: 'ALF-b1', factory_state: 'blocked', blocked_from: 'done' }),
        makeStory('i2', 'e1', {
          ref: 'ALF-b2',
          factory_state: 'blocked',
          blocked_from: 'in_development',
        }),
      ],
    });

    expect(screen.getByText('2 blocked')).toBeInTheDocument();
  });

  it('hides abandoned stories until Show abandoned is toggled on', async () => {
    const user = userEvent.setup();
    renderBoard({
      epics: [makeEpic('e1')],
      stories: [makeStory('i1', 'e1', { ref: 'ALF-gone', factory_state: 'abandoned' })],
    });

    expect(screen.queryByText('ALF-gone')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show abandoned/i }));

    expect(screen.getByText('ALF-gone')).toBeInTheDocument();
    // The card keeps its Abandoned pill, under the bucket's "Abandoned" heading.
    expect(screen.getByRole('heading', { name: 'Abandoned' })).toBeInTheDocument();
    expect(screen.getAllByText('Abandoned')).toHaveLength(2);
    // Abandoned is a bucket, never a swimlane.
    expect(screen.queryByRole('region', { name: /^abandoned$/i })).not.toBeInTheDocument();
  });

  describe('the status filter', () => {
    it('renders a Filter by status control', () => {
      renderBoard({ epics: [makeEpic('e1')] });

      expect(screen.getByRole('button', { name: /filter by status/i })).toBeInTheDocument();
    });

    it('shows every swimlane and no count at the default (all statuses shown)', () => {
      renderBoard({ epics: [makeEpic('e1')] });

      // The resting default matches the pre-filter board, so the trigger carries no count.
      expect(screen.getByRole('button', { name: 'Filter by status' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Needs Refinement' })).toBeInTheDocument();
    });

    it('hides a swimlane column across every epic when its status is unchecked', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1'), makeEpic('e2')] });

      // Both epics show all six lanes by default.
      expect(screen.getAllByRole('region', { name: 'Needs Refinement' })).toHaveLength(2);

      // Uncheck "Needs Refinement" (the 1st happy-path option). Radix portals set
      // pointer-events:none on the body, so drive the menu by keyboard (see backlog.test.tsx).
      await user.click(screen.getByRole('button', { name: /filter by status/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');
      await user.keyboard('[Escape]');

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Needs Refinement' })).not.toBeInTheDocument();
      });
      // The remaining lanes stay on both epics; only the unchecked column is gone.
      expect(screen.getAllByRole('region', { name: 'In Development' })).toHaveLength(2);
    });

    it('surfaces a count on the trigger once a status is unchecked', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1')] });
      expect(screen.getByRole('button', { name: 'Filter by status' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /filter by status/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');
      await user.keyboard('[Escape]');

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /filter by status \(\d+\)/i }),
        ).toBeInTheDocument();
      });
    });

    it('hides a blocked card along with the lane it was blocked from', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [
          makeStory('i1', 'e1', {
            ref: 'ALF-blocked',
            factory_state: 'blocked',
            blocked_from: 'needs_refinement',
          }),
        ],
      });

      expect(screen.getByText('ALF-blocked')).toBeInTheDocument();

      // A blocked card now lives IN a lane (ALF-136), so unchecking that lane takes it with it —
      // the opposite of the old off-track bucket, which the column filter never touched.
      await user.click(screen.getByRole('button', { name: /filter by status/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');
      await user.keyboard('[Escape]');

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Needs Refinement' })).not.toBeInTheDocument();
      });
      expect(screen.queryByText('ALF-blocked')).not.toBeInTheDocument();
    });

    it('leaves the abandoned bucket unaffected by the column filter', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-gone', factory_state: 'abandoned' })],
      });

      await user.click(screen.getByRole('button', { name: /show abandoned/i }));
      expect(screen.getByText('ALF-gone')).toBeInTheDocument();

      // Abandoned is never a lane, so no column can filter it away.
      await user.click(screen.getByRole('button', { name: /filter by status/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');
      await user.keyboard('[Escape]');

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Needs Refinement' })).not.toBeInTheDocument();
      });
      expect(screen.getByText('ALF-gone')).toBeInTheDocument();
    });
  });

  // Below `md` the three view filters fold into a single ⋯ menu (ALF-134). The desktop controls
  // stay in the DOM under jsdom (media queries don't apply), so these drive the menu copies and
  // assert the board itself reacts — the wiring, not just the toolbar's own callbacks.
  describe('the mobile ⋯ filter menu', () => {
    it('reveals abandoned stories from the menu', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-gone', factory_state: 'abandoned' })],
      });

      expect(screen.queryByText('ALF-gone')).not.toBeInTheDocument();

      const menu = await openFilterMenu(user);
      await user.click(within(menu).getByRole('menuitemcheckbox', { name: /show abandoned/i }));
      await closeFilterMenu(user);

      expect(screen.getByText('ALF-gone')).toBeInTheDocument();
    });

    it('reveals archived epics from the menu', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [
          makeEpic('e1', { name: 'Active epic' }),
          makeEpic('e2', { name: 'Old epic', archived_at: '2025-02-01T00:00:00Z' }),
        ],
      });

      expect(screen.queryByRole('button', { name: /^old epic/i })).not.toBeInTheDocument();

      const menu = await openFilterMenu(user);
      await user.click(within(menu).getByRole('menuitemcheckbox', { name: /show archived/i }));
      await closeFilterMenu(user);

      expect(screen.getByRole('button', { name: /^old epic/i })).toBeInTheDocument();
    });

    it('hides a swimlane from the menu’s status submenu', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1')] });

      expect(screen.getByRole('region', { name: 'Needs Refinement' })).toBeInTheDocument();

      await openFilterMenu(user);
      // Keyboard-driven (Radix portals set pointer-events:none on the body): ↓ lands on the
      // submenu trigger, → opens it onto its first option, ↵ unchecks it.
      await user.keyboard('[ArrowDown][ArrowRight][Enter]');
      await closeFilterMenu(user);

      expect(screen.queryByRole('region', { name: 'Needs Refinement' })).not.toBeInTheDocument();
      // The remaining lanes are untouched.
      expect(screen.getByRole('region', { name: 'In Development' })).toBeInTheDocument();
    });
  });

  describe('the detail modal', () => {
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

    it('opens the modal for a story named by the ?story= deep-link param', () => {
      mockStoryParam = 'ALF-7';
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-7', title: 'Deep linked' })],
      });

      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByText('ALF-7')).toBeInTheDocument();
      expect(dialog.getByText('Deep linked')).toBeInTheDocument();
    });

    it('ignores a ?story= ref that is not in this project', () => {
      mockStoryParam = 'ALF-999';
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-7' })],
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('clears the ?story= param when the deep-linked modal is closed', async () => {
      const user = userEvent.setup();
      mockStoryParam = 'ALF-7';
      const replaceState = jest.spyOn(globalThis.history, 'replaceState');
      renderBoard({
        projectId: 'p1',
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-7', title: 'Deep linked' })],
      });

      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(replaceState).toHaveBeenCalledWith(null, '', '/code/p1');
      replaceState.mockRestore();
    });
  });

  describe('Collapse all / Open all button', () => {
    it('shows "Collapse all" when at least one epic is expanded', () => {
      renderBoard({ epics: [makeEpic('e1'), makeEpic('e2')] });

      expect(screen.getByRole('button', { name: /collapse all/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open all/i })).not.toBeInTheDocument();
    });

    it('collapses all visible epics when "Collapse all" is clicked', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1', { name: 'Alpha' }), makeEpic('e2', { name: 'Beta' })],
      });

      await user.click(screen.getByRole('button', { name: /collapse all/i }));

      expect(screen.getByRole('button', { name: /^alpha/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.getByRole('button', { name: /^beta/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('switches to "Open all" once all visible epics are collapsed', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1')] });

      await user.click(screen.getByRole('button', { name: /collapse all/i }));

      expect(screen.getByRole('button', { name: /open all/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /collapse all/i })).not.toBeInTheDocument();
    });

    it('expands all visible epics when "Open all" is clicked', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1', { name: 'Alpha' }), makeEpic('e2', { name: 'Beta' })],
      });

      await user.click(screen.getByRole('button', { name: /collapse all/i }));
      await user.click(screen.getByRole('button', { name: /open all/i }));

      expect(screen.getByRole('button', { name: /^alpha/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByRole('button', { name: /^beta/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('is not shown when there are no epics', () => {
      renderBoard({ epics: [] });

      expect(screen.queryByRole('button', { name: /collapse all/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open all/i })).not.toBeInTheDocument();
    });

    it('does not collapse hidden archived epics when show archived is off', async () => {
      const user = userEvent.setup();
      renderBoard({
        epics: [
          makeEpic('e1', { name: 'Active' }),
          makeEpic('e2', { name: 'Old', archived_at: '2025-02-01T00:00:00Z' }),
        ],
      });

      await user.click(screen.getByRole('button', { name: /collapse all/i }));

      // Reveal the archived epic — it was not in the visible set, so it starts expanded.
      await user.click(screen.getByRole('button', { name: /show archived/i }));
      expect(screen.getByRole('button', { name: /^old/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  describe('the epic header controls', () => {
    it('edits the epic notes via updateEpic', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { notes: 'New notes' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      await user.click(screen.getByRole('button', { name: /add epic notes/i }));
      await user.type(screen.getByRole('textbox', { name: /edit epic notes/i }), 'New notes');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { notes: 'New notes' });
    });

    it('archives an epic via the 3-dot menu (sets archived_at)', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { archived_at: '2026-02-01T00:00:00Z' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      // Open the epic actions dropdown, then click Archive.
      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /^archive$/i }));

      await waitFor(() => {
        expect(mockUpdateEpic).toHaveBeenCalledTimes(1);
      });
      const [id, patch] = mockUpdateEpic.mock.calls[0] ?? [];
      expect(id).toBe('e1');
      expect((patch as { archived_at?: string | null }).archived_at).toEqual(expect.any(String));
    });

    it('un-archives an archived epic via the 3-dot menu (clears archived_at)', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { archived_at: null }));
      const user = userEvent.setup();
      renderBoard({
        epics: [makeEpic('e1', { name: 'Old epic', archived_at: '2026-01-01T00:00:00Z' })],
      });

      // Reveal the archived epic, expand it, then un-archive via the actions menu.
      await user.click(screen.getByRole('button', { name: /show archived/i }));
      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /^unarchive$/i }));

      expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { archived_at: null });
    });

    it('renames an epic inline via the 3-dot menu "Edit title"', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { name: 'New Name' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Old Name' })] });

      // Open menu → Edit title → type new name → press Enter to save.
      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /edit title/i }));

      // Wait for the input to appear (Radix closes the dropdown after onSelect fires).
      const input = await screen.findByRole('textbox', { name: /edit epic title/i });
      expect(input).toBeInTheDocument();

      await user.clear(input);
      await user.type(input, 'New Name');
      await user.keyboard('{Enter}');

      expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { name: 'New Name' });
    });

    it('cancels the title edit when Escape is pressed', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Keep This' })] });

      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /edit title/i }));

      // Wait for the input to appear.
      const input = await screen.findByRole('textbox', { name: /edit epic title/i });
      await user.type(input, ' changed');
      await user.keyboard('{Escape}');

      // The input disappears and the original title is still shown.
      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /edit epic title/i })).not.toBeInTheDocument();
      });
      expect(screen.getByText('Keep This')).toBeInTheDocument();
      expect(mockUpdateEpic).not.toHaveBeenCalled();
    });

    it('cancels the title edit when clicking outside the editor', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Keep This' })] });

      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /edit title/i }));

      const input = await screen.findByRole('textbox', { name: /edit epic title/i });
      await user.type(input, ' changed');

      // A pointerdown outside the editor dismisses it (survives Radix focus restoration, which
      // a blur-based dismiss would trip over when opening from the dropdown menu).
      await user.click(document.body);

      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /edit epic title/i })).not.toBeInTheDocument();
      });
      expect(screen.getByText('Keep This')).toBeInTheDocument();
      expect(mockUpdateEpic).not.toHaveBeenCalled();
    });

    it('saves the title when the confirm check is clicked', async () => {
      mockUpdateEpic.mockResolvedValue(makeEpic('e1', { name: 'New Name' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Old Name' })] });

      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /edit title/i }));

      const input = await screen.findByRole('textbox', { name: /edit epic title/i });
      await user.clear(input);
      await user.type(input, 'New Name');
      // The confirm check sits inside the editor's form, so clicking it commits (it does not
      // register as an outside click).
      await user.click(screen.getByRole('button', { name: /confirm title/i }));

      await waitFor(() => {
        expect(mockUpdateEpic).toHaveBeenCalledWith('e1', { name: 'New Name' });
      });
    });
  });

  describe('the new-story "+" button', () => {
    it('renders a "+" naming the epic, to the left of the actions menu', () => {
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      expect(screen.getByRole('button', { name: /new story in plumbing/i })).toBeInTheDocument();
    });

    it('opens the new-story dialog scoped to that epic', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /new story in plumbing/i }));

      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByText(/new story in/i)).toBeInTheDocument();
      expect(dialog.getByText('Plumbing')).toBeInTheDocument();
      expect(dialog.getByLabelText(/title/i)).toBeInTheDocument();
    });

    it('hides the "+" while the epic title is being renamed', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      await user.click(screen.getByRole('button', { name: /epic actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /edit title/i }));

      await screen.findByRole('textbox', { name: /edit epic title/i });
      expect(
        screen.queryByRole('button', { name: /new story in plumbing/i }),
      ).not.toBeInTheDocument();
    });

    it('creates a story through the store when the dialog is submitted', async () => {
      mockCreateCodeStory.mockResolvedValue(makeSidecar({ item_id: 'new-1', ref: 'ALF-12' }));
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1', { name: 'Plumbing' })] });

      await user.click(screen.getByRole('button', { name: /new story in plumbing/i }));
      await user.type(screen.getByLabelText(/title/i), 'A fresh story');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(mockCreateCodeStory).toHaveBeenCalledWith('p1', 'e1', 'A fresh story', null);
      });
    });
  });

  describe('the "Create epic" button', () => {
    it('renders in the toolbar even when the project has no epics', () => {
      renderBoard({ epics: [] });

      expect(screen.getByRole('button', { name: /create epic/i })).toBeInTheDocument();
    });

    it('opens the new-epic dialog scoped to the project', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [] });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /create epic/i }));

      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByText(/new epic/i)).toBeInTheDocument();
      // The dialog names the project the epic lands in.
      expect(dialog.getByText('Alfred')).toBeInTheDocument();
      expect(dialog.getByLabelText(/epic name/i)).toBeInTheDocument();
    });

    it('creates an epic through the store when the dialog is submitted', async () => {
      mockCreateEpic.mockResolvedValue(makeEpic('new-1', { name: 'Comms', ref: 'ALF-9' }));
      const user = userEvent.setup();
      renderBoard({ epics: [] });

      await user.click(screen.getByRole('button', { name: /create epic/i }));

      const dialog = within(screen.getByRole('dialog'));
      await user.type(dialog.getByLabelText(/epic name/i), 'Comms');
      await user.click(dialog.getByRole('button', { name: /create epic/i }));

      await waitFor(() => {
        expect(mockCreateEpic).toHaveBeenCalledWith('p1', 'Comms');
      });
    });
  });

  describe('the Done lane collapse (ALF-81)', () => {
    // Five done stories with ascending completion timestamps; d5 is the most recent.
    const doneStories = Array.from({ length: 5 }, (_, index) => {
      const n = String(index + 1);
      return makeStory(`d${n}`, 'e1', {
        ref: `ALF-d${n}`,
        title: `Done ${n}`,
        factory_state: 'done',
        code_updated_at: `2025-0${n}-01T00:00:00Z`,
      });
    });

    it('shows only the latest 3 completions, newest first, with a Show more control', () => {
      renderBoard({ epics: [makeEpic('e1')], stories: doneStories });

      const lane = screen.getByRole('region', { name: 'Done' });
      const shown = within(lane)
        .getAllByRole('button', { name: /^open /i })
        .map((card) => card.getAttribute('aria-label'));
      // Latest three by code_updated_at: d5, d4, d3 (not d1/d2), in recency order.
      expect(shown).toHaveLength(3);
      expect(shown[0]).toContain('ALF-d5');
      expect(shown[1]).toContain('ALF-d4');
      expect(shown[2]).toContain('ALF-d3');
      expect(within(lane).getByText('5')).toBeInTheDocument();
      expect(within(lane).getByRole('button', { name: /show \d+ more/i })).toBeInTheDocument();
    });

    it('reveals the remaining completions when Show more is clicked', async () => {
      const user = userEvent.setup();
      renderBoard({ epics: [makeEpic('e1')], stories: doneStories });

      const lane = screen.getByRole('region', { name: 'Done' });
      await user.click(within(lane).getByRole('button', { name: /show \d+ more/i }));

      expect(within(lane).getAllByRole('button', { name: /^open /i })).toHaveLength(5);
      expect(
        within(lane).queryByRole('button', { name: /show \d+ more/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('realtime swimlane updates', () => {
    it('moves a card to its new swimlane on an external code_items UPDATE, no refresh', () => {
      renderBoard({
        epics: [makeEpic('e1')],
        stories: [makeStory('i1', 'e1', { ref: 'ALF-7', factory_state: 'in_refinement' })],
      });

      // Seeded in the In Refinement lane.
      const before = screen.getByRole('region', { name: 'In Refinement' });
      expect(within(before).getByText('ALF-7')).toBeInTheDocument();

      // A second writer (the webhook Worker) advances the story; the realtime UPDATE arrives.
      act(() => {
        mockRealtimeHandler?.({
          new: makeSidecar({ item_id: 'i1', ref: 'ALF-7', factory_state: 'ready_for_dev' }),
        });
      });

      // The card has moved to Ready for Dev with no user interaction or navigation.
      const after = screen.getByRole('region', { name: 'Ready for Dev' });
      expect(within(after).getByText('ALF-7')).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'In Refinement' })).queryByText('ALF-7'),
      ).not.toBeInTheDocument();
    });
  });
});
