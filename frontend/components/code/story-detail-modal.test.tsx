import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import type { LaunchPhase } from '@/lib/code/launch';
import { CodeProvider, useProjectBoard } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import { StoryDetailModal } from './story-detail-modal';

// react-markdown (and remark-gfm) are pure ESM; jest's default transform ignores
// node_modules, so importing the real package throws "Unexpected token 'export'". Mock the
// seam — render the markdown source into a real container so the test can assert the spec
// TEXT is passed through and rendered. The faithful markdown→HTML rendering (heading/list
// elements) is verified by the Storybook visual snapshot + the Playwright e2e, which run a
// real bundler/browser (no ESM problem). This mocks the dependency, it does not weaken config.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

// The store calls api-client on the title edit; mock it so nothing hits the network.
jest.mock('@/lib/api-client');
const mockUpdateItem = jest.mocked(api.updateItem);
const mockUpdateCodeState = jest.mocked(api.updateCodeState);
const mockMoveCodeEpic = jest.mocked(api.moveCodeEpic);
const mockMoveCode = jest.mocked(api.moveCode);
const mockMoveCodeInProject = jest.mocked(api.moveCodeInProject);

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
  name: 'Communication Firewall',
  notes: null,
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};

/** Build an epic row, defaulting to an active epic in project p1. */
function makeEpic(id: string, overrides: Partial<Epic> = {}): Epic {
  return { ...EPIC, id, name: `Epic ${id}`, ref: `ALF-${id}`, ...overrides };
}

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
    factory_state: 'needs_refinement',
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
    title: 'Wire up the webhook',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Communication Firewall',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

/** The saved `code_items` row the PATCH route returns, which the store reconciles with. */
function makeSidecar(overrides: Partial<CodeItem> = {}): CodeItem {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
    factory_state: 'needs_refinement',
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
    updated_at: '2025-02-02T00:00:00Z',
    priority: 1,
    ...overrides,
  };
}

/**
 * A harness that re-reads the live story from the store by item_id — exactly how the board
 * mounts the modal (so an optimistic store update, e.g. a title edit, reflects in the modal).
 */
function ModalHarness({
  itemId,
  onOpenSession,
}: {
  itemId: string;
  onOpenSession: (s: CodeStory, p: LaunchPhase) => void | Promise<void>;
}) {
  const board = useProjectBoard('p1');
  const live = board.activeEpics
    .flatMap((b) => [...b.lanes.flatMap((l) => l.stories), ...b.abandonedStories])
    .find((s) => s.item_id === itemId);
  return (
    <StoryDetailModal
      story={live ?? null}
      open={live !== undefined}
      onOpenChange={jest.fn()}
      onOpenSession={onOpenSession}
    />
  );
}

function renderModal(
  story: CodeStory,
  options: {
    onOpenSession?: (s: CodeStory, p: LaunchPhase) => void | Promise<void>;
  } = {},
) {
  const onOpenSession = options.onOpenSession ?? jest.fn(() => Promise.resolve());
  const utils = render(
    <ToastProvider>
      <CodeProvider initialProjects={[PROJECT]} initialEpics={[EPIC]} initialStories={[story]}>
        <ModalHarness itemId={story.item_id ?? ''} onOpenSession={onOpenSession} />
      </CodeProvider>
    </ToastProvider>,
  );
  // Portaled content lives on document.body — query the dialog from there (RTL skill).
  const dialog = within(screen.getByRole('dialog'));
  return { ...utils, dialog, onOpenSession };
}

/** Render the modal with other stories seeded alongside it (for the priority rank flags). */
function renderModalWithPeers(story: CodeStory, peers: CodeStory[]) {
  render(
    <ToastProvider>
      <CodeProvider
        initialProjects={[PROJECT]}
        initialEpics={[EPIC]}
        initialStories={[story, ...peers]}
      >
        <ModalHarness
          itemId={story.item_id ?? ''}
          onOpenSession={jest.fn(() => Promise.resolve())}
        />
      </CodeProvider>
    </ToastProvider>,
  );
  return within(screen.getByRole('dialog'));
}

/** Render the modal with a custom set of seeded epics (for the move-to-epic dropdown). */
function renderModalWithEpics(story: CodeStory, epics: Epic[]) {
  render(
    <ToastProvider>
      <CodeProvider initialProjects={[PROJECT]} initialEpics={epics} initialStories={[story]}>
        <ModalHarness
          itemId={story.item_id ?? ''}
          onOpenSession={jest.fn(() => Promise.resolve())}
        />
      </CodeProvider>
    </ToastProvider>,
  );
  return within(screen.getByRole('dialog'));
}

describe('StoryDetailModal', () => {
  it('renders nothing visible when closed', () => {
    render(
      <ToastProvider>
        <CodeProvider initialProjects={[PROJECT]} initialEpics={[EPIC]} initialStories={[]}>
          <StoryDetailModal
            story={null}
            open={false}
            onOpenChange={jest.fn()}
            onOpenSession={jest.fn()}
          />
        </CodeProvider>
      </ToastProvider>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the ref, title, breadcrumb, and the state chip', () => {
    const { dialog } = renderModal(makeStory());

    expect(dialog.getByText('ALF-42')).toBeInTheDocument();
    expect(dialog.getByText('Wire up the webhook')).toBeInTheDocument();
    expect(dialog.getByText(/Alfred/)).toBeInTheDocument();
    expect(dialog.getByText(/Communication Firewall/)).toBeInTheDocument();
    // Target the chip specifically — the status dropdown's trigger shows the same label.
    expect(
      dialog.getByText('Needs Refinement', { selector: '[data-factory-state]' }),
    ).toBeInTheDocument();
  });

  it('gives the close button a ≥44px tap target on mobile, back to compact at md+', () => {
    // The dismiss is the shared DialogCloseButton, so the modal inherits the target rather than
    // carrying its own copy: h-11/w-11 = 44px on mobile, md:* restores the compact hit area.
    const { dialog } = renderModal(makeStory());

    expect(dialog.getByRole('button', { name: 'Close' })).toHaveClass(
      'h-11',
      'w-11',
      'md:h-auto',
      'md:w-auto',
      'md:p-1',
    );
  });

  describe('inline title edit', () => {
    it('PATCHes the item and reflects the new title in the store', async () => {
      mockUpdateItem.mockResolvedValue({ title: 'Renamed' } as never);
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory());

      await user.click(dialog.getByText('Wire up the webhook'));
      const input = dialog.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Renamed');
      await user.click(dialog.getByRole('button', { name: /confirm title/i }));

      expect(mockUpdateItem).toHaveBeenCalledWith('i1', { title: 'Renamed' });
      await waitFor(() => {
        expect(dialog.getByText('Renamed')).toBeInTheDocument();
      });
    });

    it('reverts to view mode on Escape without saving', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory());

      await user.click(dialog.getByText('Wire up the webhook'));
      await user.type(dialog.getByRole('textbox', { name: /edit title/i }), 'x');
      await user.keyboard('{Escape}');

      expect(mockUpdateItem).not.toHaveBeenCalled();
      expect(dialog.getByText('Wire up the webhook')).toBeInTheDocument();
    });
  });

  describe('spec body', () => {
    it('renders the spec markdown (via react-markdown) when present', () => {
      const { dialog } = renderModal(
        makeStory({
          factory_state: 'ready_for_dev',
          spec_markdown: '# The spec\n\n- item one\n- item two',
          spec_path: 'docs/specs/ALF-42.md',
          spec_sha: 'abc123',
        }),
      );

      const md = dialog.getByTestId('markdown');
      // The markdown SOURCE is handed to react-markdown for rendering.
      expect(md).toHaveTextContent('# The spec');
      expect(md).toHaveTextContent('item one');
    });

    it('renders an HTML-document spec in a sandboxed iframe (not via react-markdown)', () => {
      const html =
        '<!doctype html><html><head><title>ALF-42</title></head><body><h1>The plan</h1></body></html>';
      const { dialog } = renderModal(
        makeStory({
          factory_state: 'ready_for_dev',
          spec_markdown: html,
          spec_path: 'docs/specs/ALF-42.html',
          spec_sha: 'abc123',
        }),
      );

      const frame = dialog.getByTestId('spec-html');
      // The whole snapshot is handed to the frame's srcDoc so its own CSS/SVG renders in isolation.
      expect(frame).toHaveAttribute('srcdoc', html);
      // Sandboxed with no allow-scripts, so any <script> in the committed spec stays inert.
      expect(frame).toHaveAttribute('sandbox', '');
      // It is NOT routed through the markdown renderer.
      expect(dialog.queryByTestId('markdown')).not.toBeInTheDocument();
    });

    it('builds the View-in-repo link from owner/name + sha + path', () => {
      const { dialog } = renderModal(
        makeStory({
          factory_state: 'ready_for_dev',
          spec_markdown: '# spec',
          spec_path: 'docs/specs/ALF-42.md',
          spec_sha: 'deadbeef',
        }),
      );

      const link = dialog.getByRole('link', { name: /view in repo/i });
      expect(link).toHaveAttribute(
        'href',
        'https://github.com/ac3charland/alfred/blob/deadbeef/docs/specs/ALF-42.md',
      );
    });

    it('falls back to a "no spec yet" note when spec_markdown is null', () => {
      const { dialog } = renderModal(makeStory({ spec_markdown: null, spec_path: null }));

      expect(dialog.queryByTestId('markdown')).not.toBeInTheDocument();
      expect(dialog.getByText(/no spec yet/i)).toBeInTheDocument();
    });
  });

  describe('PR links', () => {
    it('shows the refinement and implementation PR links when present', () => {
      const { dialog } = renderModal(
        makeStory({
          factory_state: 'done',
          refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/1',
          implementation_pr_url: 'https://github.com/ac3charland/alfred/pull/2',
        }),
      );

      expect(dialog.getByRole('link', { name: /refinement pr/i })).toHaveAttribute(
        'href',
        'https://github.com/ac3charland/alfred/pull/1',
      );
      expect(dialog.getByRole('link', { name: /implementation pr/i })).toHaveAttribute(
        'href',
        'https://github.com/ac3charland/alfred/pull/2',
      );
    });

    it('omits PR links when the urls are null', () => {
      const { dialog } = renderModal(makeStory());
      expect(dialog.queryByRole('link', { name: /pr$/i })).not.toBeInTheDocument();
    });
  });

  describe('the primary launch action', () => {
    // Match the launch button by its full label so it doesn't collide with anything else in
    // the modal that mentions a refinement state.
    const refineButton = /refine in claude/i;
    const implementButton = /implement in claude/i;

    it('shows the Refine button in needs_refinement and reuses onOpenSession', async () => {
      const onOpenSession = jest.fn(() => Promise.resolve());
      const user = userEvent.setup();
      const story = makeStory({ factory_state: 'needs_refinement' });
      const { dialog } = renderModal(story, { onOpenSession });

      const button = dialog.getByRole('button', { name: refineButton });
      await user.click(button);

      expect(onOpenSession).toHaveBeenCalledWith(story, 'refinement');
    });

    it('shows the Implement button in ready_for_dev', () => {
      const { dialog } = renderModal(makeStory({ factory_state: 'ready_for_dev' }));

      expect(dialog.getByRole('button', { name: implementButton })).toBeInTheDocument();
      expect(dialog.queryByRole('button', { name: refineButton })).not.toBeInTheDocument();
    });

    it('shows the subordinate Skip to Development button in needs_refinement', async () => {
      const onOpenSession = jest.fn(() => Promise.resolve());
      const user = userEvent.setup();
      const story = makeStory({ factory_state: 'needs_refinement' });
      const { dialog } = renderModal(story, { onOpenSession });

      await user.click(dialog.getByRole('button', { name: /skip to development/i }));

      expect(onOpenSession).toHaveBeenCalledWith(story, 'bypass');
    });

    it.each(['in_refinement', 'in_development', 'ready_for_review', 'done'] as const)(
      'hides the launch button in the %s state',
      (state) => {
        const { dialog } = renderModal(makeStory({ factory_state: state }));
        expect(dialog.queryByRole('button', { name: refineButton })).not.toBeInTheDocument();
        expect(dialog.queryByRole('button', { name: implementButton })).not.toBeInTheDocument();
      },
    );
  });

  describe('the "Needs refinement" mark', () => {
    const mark = /needs refinement/i;

    it('renders with the story’s current value', () => {
      const checked = renderModal(makeStory({ requires_refinement: true }));
      expect(checked.dialog.getByRole('checkbox', { name: mark })).toBeChecked();
      checked.unmount();

      const cleared = renderModal(
        makeStory({ factory_state: 'ready_for_dev', requires_refinement: false }),
      );
      expect(cleared.dialog.getByRole('checkbox', { name: mark })).not.toBeChecked();
    });

    it('parks a needs_refinement story in Ready for Dev, with no tab opened', async () => {
      mockUpdateCodeState.mockResolvedValue(
        makeSidecar({ factory_state: 'ready_for_dev', requires_refinement: false }),
      );
      const openSpy = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'needs_refinement' }));

      await user.click(dialog.getByRole('checkbox', { name: mark }));

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'ready_for_dev', {
        requires_refinement: false,
      });
      // The launch button behind the modal swaps from Refine to Implement…
      await waitFor(() => {
        expect(dialog.getByRole('button', { name: /implement in claude/i })).toBeInTheDocument();
      });
      // …and unlike Skip to Development, nothing opened.
      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });

    it('re-checking it sends a spec-less ready_for_dev story back to Needs Refinement', async () => {
      mockUpdateCodeState.mockResolvedValue(
        makeSidecar({ factory_state: 'needs_refinement', requires_refinement: true }),
      );
      const user = userEvent.setup();
      const { dialog } = renderModal(
        makeStory({ factory_state: 'ready_for_dev', requires_refinement: false }),
      );

      await user.click(dialog.getByRole('checkbox', { name: mark }));

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'needs_refinement', {
        requires_refinement: true,
      });
    });

    it('records the mark without moving a story in another state', async () => {
      mockUpdateCodeState.mockResolvedValue(
        makeSidecar({ factory_state: 'ready_for_review', requires_refinement: false }),
      );
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'ready_for_review' }));

      await user.click(dialog.getByRole('checkbox', { name: mark }));

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'ready_for_review', {
        requires_refinement: false,
      });
    });

    it('restores the box when the write fails', async () => {
      mockUpdateCodeState.mockRejectedValue(new Error('patch failed'));
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'needs_refinement' }));

      await user.click(dialog.getByRole('checkbox', { name: mark }));

      await waitFor(() => {
        expect(dialog.getByRole('checkbox', { name: mark })).toBeChecked();
      });
      expect(dialog.getByRole('button', { name: /refine in claude/i })).toBeInTheDocument();
    });
  });

  describe('the epic move dropdown', () => {
    const ROUTING = makeEpic('e2', { name: 'Routing', ref: 'ALF-2' });
    const ARCHIVED = makeEpic('e3', {
      name: 'Archived Epic',
      ref: 'ALF-3',
      archived_at: '2026-02-01T00:00:00Z',
    });
    const OTHER_PROJECT = makeEpic('e4', {
      name: 'Other Project Epic',
      ref: 'RLP-1',
      project_id: 'p2',
    });

    it('lists the other active same-project epics (not the current/archived/other-project ones)', async () => {
      const user = userEvent.setup();
      const dialog = renderModalWithEpics(makeStory(), [EPIC, ROUTING, ARCHIVED, OTHER_PROJECT]);

      await user.click(dialog.getByRole('button', { name: /change epic/i }));
      await screen.findByRole('menu');

      // The one valid candidate is offered…
      expect(screen.getByRole('menuitem', { name: /Routing/i })).toBeInTheDocument();
      // …and the archived, other-project, and current epics are not.
      expect(screen.queryByRole('menuitem', { name: /Archived Epic/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: /Other Project Epic/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: /Communication Firewall/i }),
      ).not.toBeInTheDocument();
    });

    it('moves the story to the chosen epic (PATCHes epic_id by ref)', async () => {
      mockMoveCodeEpic.mockResolvedValue({
        epic_id: 'e2',
        updated_at: '2026-02-02T00:00:00Z',
      } as never);
      const user = userEvent.setup();
      const dialog = renderModalWithEpics(makeStory(), [EPIC, ROUTING]);

      await user.click(dialog.getByRole('button', { name: /change epic/i }));
      await screen.findByRole('menu');
      // Radix portals set pointer-events:none on the body, so select via the keyboard.
      await user.keyboard('[ArrowDown][Enter]');

      expect(mockMoveCodeEpic).toHaveBeenCalledWith('ALF-42', 'e2');
    });

    it('renders the epic as plain text (no dropdown) when the project has no other active epic', () => {
      const dialog = renderModalWithEpics(makeStory(), [EPIC]);

      expect(dialog.getByText('Communication Firewall')).toBeInTheDocument();
      expect(dialog.queryByRole('button', { name: /change epic/i })).not.toBeInTheDocument();
    });
  });

  describe('notes editor', () => {
    it('shows "Add notes…" affordance when story has no notes', () => {
      const { dialog } = renderModal(makeStory({ notes: null }));

      expect(dialog.getByText('Add notes…')).toBeInTheDocument();
      expect(dialog.queryByRole('textbox', { name: /edit notes/i })).not.toBeInTheDocument();
    });

    it('shows existing notes as text when present', () => {
      const { dialog } = renderModal(makeStory({ notes: 'Needs auth header' }));

      expect(dialog.getByText('Needs auth header')).toBeInTheDocument();
      expect(dialog.queryByRole('textbox', { name: /edit notes/i })).not.toBeInTheDocument();
    });

    it('clicking the affordance enters edit mode with the textarea', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: null }));

      await user.click(dialog.getByText('Add notes…'));

      expect(dialog.getByRole('textbox', { name: /edit notes/i })).toBeInTheDocument();
    });

    it('Save calls updateStoryNotes with the trimmed value', async () => {
      mockUpdateItem.mockResolvedValue({ notes: 'Check the logs' } as never);
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: null }));

      await user.click(dialog.getByText('Add notes…'));
      await user.type(dialog.getByRole('textbox', { name: /edit notes/i }), '  Check the logs  ');
      await user.click(dialog.getByRole('button', { name: /save/i }));

      expect(mockUpdateItem).toHaveBeenCalledWith('i1', { notes: 'Check the logs' });
    });

    it('⌘+Enter calls updateStoryNotes without reaching for the Save button', async () => {
      mockUpdateItem.mockResolvedValue({ notes: 'Check the logs' } as never);
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: null }));

      await user.click(dialog.getByText('Add notes…'));
      await user.type(dialog.getByRole('textbox', { name: /edit notes/i }), 'Check the logs');
      await user.keyboard('{Meta>}{Enter}{/Meta}');

      expect(mockUpdateItem).toHaveBeenCalledWith('i1', { notes: 'Check the logs' });
    });

    it('Save with empty text sends null (clearing notes)', async () => {
      mockUpdateItem.mockResolvedValue({ notes: null } as never);
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: 'Remove me' }));

      await user.click(dialog.getByText('Remove me'));
      const textarea = dialog.getByRole('textbox', { name: /edit notes/i });
      await user.clear(textarea);
      await user.click(dialog.getByRole('button', { name: /save/i }));

      expect(mockUpdateItem).toHaveBeenCalledWith('i1', { notes: null });
    });

    it('Save is a no-op when the value is unchanged', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: 'Original' }));

      await user.click(dialog.getByText('Original'));
      await user.click(dialog.getByRole('button', { name: /save/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('Cancel exits edit mode without saving and restores the displayed notes', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: 'Keep me' }));

      await user.click(dialog.getByText('Keep me'));
      const textarea = dialog.getByRole('textbox', { name: /edit notes/i });
      await user.clear(textarea);
      await user.type(textarea, 'changed');
      await user.click(dialog.getByRole('button', { name: /cancel/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
      expect(dialog.getByText('Keep me')).toBeInTheDocument();
    });

    it('Escape exits edit mode without saving', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: 'Keep me' }));

      await user.click(dialog.getByText('Keep me'));
      await user.keyboard('{Escape}');

      expect(mockUpdateItem).not.toHaveBeenCalled();
      expect(dialog.getByText('Keep me')).toBeInTheDocument();
    });

    it('a rejected save rolls back the displayed notes', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ notes: 'Original' }));

      await user.click(dialog.getByText('Original'));
      const textarea = dialog.getByRole('textbox', { name: /edit notes/i });
      await user.clear(textarea);
      await user.type(textarea, 'Changed');
      await user.click(dialog.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(dialog.getByText('Original')).toBeInTheDocument();
      });
    });
  });

  describe('priority controls', () => {
    /** The four jump buttons, by accessible name. */
    const TOP_OF_PROJECT = /top of project/i;
    const BOTTOM_OF_PROJECT = /bottom of project/i;
    const TOP_OF_BACKLOG = /top of backlog/i;
    const BOTTOM_OF_BACKLOG = /bottom of backlog/i;

    beforeEach(() => {
      // An empty reconcile keeps the optimistic priority — these tests assert the CALL and the
      // optimistic re-rank, not the server's chosen number.
      mockMoveCode.mockResolvedValue([]);
      mockMoveCodeInProject.mockResolvedValue([]);
    });

    it('offers all four Backlog jumps under a Priority heading', () => {
      const dialog = renderModalWithPeers(makeStory({ priority: 2 }), [
        makeStory({ item_id: 'i2', ref: 'ALF-43', priority: 1 }),
        makeStory({ item_id: 'i3', ref: 'ALF-44', priority: 3 }),
      ]);

      expect(dialog.getByRole('heading', { name: /priority/i })).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: TOP_OF_PROJECT })).toBeEnabled();
      expect(dialog.getByRole('button', { name: BOTTOM_OF_PROJECT })).toBeEnabled();
      expect(dialog.getByRole('button', { name: TOP_OF_BACKLOG })).toBeEnabled();
      expect(dialog.getByRole('button', { name: BOTTOM_OF_BACKLOG })).toBeEnabled();
    });

    it('disables every jump when the story is the only one in the Backlog', () => {
      const { dialog } = renderModal(makeStory());

      expect(dialog.getByRole('button', { name: TOP_OF_PROJECT })).toBeDisabled();
      expect(dialog.getByRole('button', { name: BOTTOM_OF_PROJECT })).toBeDisabled();
      expect(dialog.getByRole('button', { name: TOP_OF_BACKLOG })).toBeDisabled();
      expect(dialog.getByRole('button', { name: BOTTOM_OF_BACKLOG })).toBeDisabled();
    });

    it('disables only the project jump when the story leads its project but another ranks above', () => {
      const dialog = renderModalWithPeers(makeStory({ priority: 1 }), [
        makeStory({ item_id: 'i2', ref: 'ALF-43', priority: 2 }),
        makeStory({ item_id: 'i3', ref: 'RLP-1', project_id: 'p2', epic_id: 'e2', priority: 0 }),
      ]);

      expect(dialog.getByRole('button', { name: TOP_OF_PROJECT })).toBeDisabled();
      expect(dialog.getByRole('button', { name: TOP_OF_BACKLOG })).toBeEnabled();
      expect(dialog.getByRole('button', { name: BOTTOM_OF_PROJECT })).toBeEnabled();
      expect(dialog.getByRole('button', { name: BOTTOM_OF_BACKLOG })).toBeEnabled();
    });

    it('ranks against outstanding work only — a done story above it does not hold the top slot', () => {
      const dialog = renderModalWithPeers(makeStory({ priority: 1 }), [
        makeStory({ item_id: 'i2', ref: 'ALF-43', priority: 0, factory_state: 'done' }),
        makeStory({ item_id: 'i3', ref: 'ALF-44', priority: 2 }),
      ]);

      // The done story keeps priority 0 but is hidden from the Backlog, so ALF-42 still leads.
      expect(dialog.getByRole('button', { name: TOP_OF_PROJECT })).toBeDisabled();
      expect(dialog.getByRole('button', { name: TOP_OF_BACKLOG })).toBeDisabled();
    });

    it('jumps to the top of the project, calling moveCodeInProject', async () => {
      const user = userEvent.setup();
      const dialog = renderModalWithPeers(makeStory({ priority: 2 }), [
        makeStory({ item_id: 'i2', ref: 'ALF-43', priority: 1 }),
      ]);

      await user.click(dialog.getByRole('button', { name: TOP_OF_PROJECT }));

      // The optimistic re-rank lands instantly, so the button it just satisfied disables.
      expect(dialog.getByRole('button', { name: TOP_OF_PROJECT })).toBeDisabled();
      expect(mockMoveCode).not.toHaveBeenCalled();
      // Only the network SYNC is debounced, so the call lands after a short delay.
      await waitFor(() => {
        expect(mockMoveCodeInProject).toHaveBeenCalledWith('ALF-42', true);
      });
    });

    it('jumps to the bottom of the project, calling moveCodeInProject', async () => {
      const user = userEvent.setup();
      const dialog = renderModalWithPeers(makeStory({ priority: 1 }), [
        makeStory({ item_id: 'i2', ref: 'ALF-43', priority: 2 }),
      ]);

      await user.click(dialog.getByRole('button', { name: BOTTOM_OF_PROJECT }));

      expect(dialog.getByRole('button', { name: BOTTOM_OF_PROJECT })).toBeDisabled();
      expect(mockMoveCode).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(mockMoveCodeInProject).toHaveBeenCalledWith('ALF-42', false);
      });
    });

    it('jumps to the top of the whole Backlog, calling moveCode', async () => {
      const user = userEvent.setup();
      const dialog = renderModalWithPeers(makeStory({ priority: 2 }), [
        makeStory({ item_id: 'i3', ref: 'RLP-1', project_id: 'p2', epic_id: 'e2', priority: 1 }),
      ]);

      await user.click(dialog.getByRole('button', { name: TOP_OF_BACKLOG }));

      expect(dialog.getByRole('button', { name: TOP_OF_BACKLOG })).toBeDisabled();
      expect(mockMoveCodeInProject).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(mockMoveCode).toHaveBeenCalledWith('ALF-42', true);
      });
    });

    it('jumps to the bottom of the whole Backlog, calling moveCode', async () => {
      const user = userEvent.setup();
      const dialog = renderModalWithPeers(makeStory({ priority: 1 }), [
        makeStory({ item_id: 'i3', ref: 'RLP-1', project_id: 'p2', epic_id: 'e2', priority: 2 }),
      ]);

      await user.click(dialog.getByRole('button', { name: BOTTOM_OF_BACKLOG }));

      expect(dialog.getByRole('button', { name: BOTTOM_OF_BACKLOG })).toBeDisabled();
      expect(mockMoveCodeInProject).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(mockMoveCode).toHaveBeenCalledWith('ALF-42', false);
      });
    });

    it('coalesces a burst of clicks into ONE network call', async () => {
      const user = userEvent.setup();
      const dialog = renderModalWithPeers(makeStory({ priority: 2 }), [
        makeStory({ item_id: 'i2', ref: 'ALF-43', priority: 1 }),
        makeStory({ item_id: 'i3', ref: 'ALF-44', priority: 3 }),
      ]);

      await user.click(dialog.getByRole('button', { name: TOP_OF_BACKLOG }));
      await user.click(dialog.getByRole('button', { name: BOTTOM_OF_BACKLOG }));

      // The LATEST direction wins; the intermediate jump never reaches the server.
      await waitFor(() => {
        expect(mockMoveCode).toHaveBeenCalledWith('ALF-42', false);
      });
      expect(mockMoveCode).toHaveBeenCalledTimes(1);
    });
  });

  describe('manual controls (fallback)', () => {
    beforeEach(() => {
      mockUpdateCodeState.mockResolvedValue({
        factory_state: 'in_refinement',
        blocked_reason: null,
        blocked_from: null,
        updated_at: '2025-02-02T00:00:00Z',
      } as never);
    });

    const statusTrigger = /change status/i;

    it('shows the current status on the dropdown trigger', () => {
      const { dialog } = renderModal(makeStory({ factory_state: 'ready_for_dev' }));

      expect(dialog.getByRole('button', { name: statusTrigger })).toHaveTextContent(
        'Ready for Dev',
      );
    });

    it('offers every happy-path status in board order, marking the current one', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'ready_for_dev' }));

      await user.click(dialog.getByRole('button', { name: statusTrigger }));
      await screen.findByRole('menu');

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Needs Refinement',
        'In Refinement',
        'Ready for Dev',
        'In Development',
        'Ready for Review',
        'Done',
      ]);
      expect(screen.getByRole('menuitem', { name: 'Ready for Dev' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      expect(screen.getByRole('menuitem', { name: 'Done' })).not.toHaveAttribute('aria-current');
    });

    it('moves the story to any status picked from the dropdown', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'needs_refinement' }));

      await user.click(dialog.getByRole('button', { name: statusTrigger }));
      await screen.findByRole('menu');
      // Radix portals set pointer-events:none on the body, so select via the keyboard —
      // five steps down from the trigger lands on the fifth lane, Ready for Review.
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowDown][ArrowDown][Enter]');

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'ready_for_review', {});
    });

    it('writes nothing when the story is already in the picked status', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'needs_refinement' }));

      await user.click(dialog.getByRole('button', { name: statusTrigger }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      expect(mockUpdateCodeState).not.toHaveBeenCalled();
    });

    it('moves a blocked story back onto the happy path, clearing the reason', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(
        makeStory({ factory_state: 'blocked', blocked_reason: 'waiting on API' }),
      );
      const trigger = dialog.getByRole('button', { name: statusTrigger });

      expect(trigger).toHaveTextContent('Blocked');

      await user.click(trigger);
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      // The reason travels with the transition — the route only forwards the key when present,
      // so a pick that omitted it would leave the story unblocked but still carrying "waiting
      // on API".
      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'needs_refinement', {
        blocked_reason: null,
      });
    });

    it('leaves the reason key out of a move between happy-path lanes', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'in_refinement' }));

      await user.click(dialog.getByRole('button', { name: statusTrigger }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'needs_refinement', {});
    });

    it('Block opens a reason field and sets blocked + the reason', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'in_development' }));

      await user.click(dialog.getByRole('button', { name: /^block$/i }));
      await user.type(dialog.getByLabelText(/why is this blocked/i), 'waiting on API');
      await user.click(dialog.getByRole('button', { name: /confirm block/i }));

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'blocked', {
        blocked_reason: 'waiting on API',
      });
    });

    it('Abandon sets the abandoned state', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'in_refinement' }));

      await user.click(dialog.getByRole('button', { name: /abandon/i }));

      // The store's updateCodeState defaults `extra` to {} before calling the api client.
      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'abandoned', {});
    });

    // ALF-136: `blocked_from` gives a blocked story somewhere to go back to. Without it, Block
    // was one-way — Advance/Revert are both disabled off the happy path, so the only exit was
    // Abandon.
    describe('Unblock', () => {
      it('returns the story to the state it was blocked from and clears the reason', async () => {
        const user = userEvent.setup();
        const { dialog } = renderModal(
          makeStory({
            factory_state: 'blocked',
            blocked_from: 'in_development',
            blocked_reason: 'waiting on API',
          }),
        );

        await user.click(dialog.getByRole('button', { name: /unblock to in development/i }));

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_development', {
          blocked_reason: null,
        });
      });

      it('falls back to the first state for a story with no recorded origin', async () => {
        const user = userEvent.setup();
        const { dialog } = renderModal(makeStory({ factory_state: 'blocked', blocked_from: null }));

        await user.click(dialog.getByRole('button', { name: /unblock to needs refinement/i }));

        expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'needs_refinement', {
          blocked_reason: null,
        });
      });

      it('is offered only while the story is blocked', () => {
        const happy = renderModal(makeStory({ factory_state: 'in_development' }));
        expect(happy.dialog.queryByRole('button', { name: /unblock/i })).not.toBeInTheDocument();
        happy.unmount();

        const gone = renderModal(makeStory({ factory_state: 'abandoned' }));
        expect(gone.dialog.queryByRole('button', { name: /unblock/i })).not.toBeInTheDocument();
      });
    });
  });
});
