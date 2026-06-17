import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeProvider, useProjectBoard } from '@/lib/stores/code-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

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
  created_at: '2025-01-01T00:00:00Z',
};

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
  onOpenSession: (s: CodeStory, p: 'refinement' | 'implementation') => void | Promise<void>;
}) {
  const board = useProjectBoard('p1');
  const live = board.activeEpics
    .flatMap((b) => [...b.lanes.flatMap((l) => l.stories), ...b.escapeStories])
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
    onOpenSession?: (s: CodeStory, p: 'refinement' | 'implementation') => void | Promise<void>;
  } = {},
) {
  const onOpenSession = options.onOpenSession ?? jest.fn(() => Promise.resolve());
  const utils = render(
    <CodeProvider initialProjects={[PROJECT]} initialEpics={[EPIC]} initialStories={[story]}>
      <ModalHarness itemId={story.item_id ?? ''} onOpenSession={onOpenSession} />
    </CodeProvider>,
  );
  // Portaled content lives on document.body — query the dialog from there (RTL skill).
  const dialog = within(screen.getByRole('dialog'));
  return { ...utils, dialog, onOpenSession };
}

describe('StoryDetailModal', () => {
  it('renders nothing visible when closed', () => {
    render(
      <CodeProvider initialProjects={[PROJECT]} initialEpics={[EPIC]} initialStories={[]}>
        <StoryDetailModal
          story={null}
          open={false}
          onOpenChange={jest.fn()}
          onOpenSession={jest.fn()}
        />
      </CodeProvider>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the ref, title, breadcrumb, and the state chip', () => {
    const { dialog } = renderModal(makeStory());

    expect(dialog.getByText('ALF-42')).toBeInTheDocument();
    expect(dialog.getByText('Wire up the webhook')).toBeInTheDocument();
    expect(dialog.getByText(/Alfred/)).toBeInTheDocument();
    expect(dialog.getByText(/Communication Firewall/)).toBeInTheDocument();
    expect(dialog.getByText('Needs Refinement')).toBeInTheDocument();
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
    // Match the launch button by its full label so it doesn't collide with the manual
    // "Revert to … Refinement" / "Advance to …" controls that also contain "refine".
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

    it.each(['in_refinement', 'in_development', 'ready_for_review', 'done'] as const)(
      'hides the launch button in the %s state',
      (state) => {
        const { dialog } = renderModal(makeStory({ factory_state: state }));
        expect(dialog.queryByRole('button', { name: refineButton })).not.toBeInTheDocument();
        expect(dialog.queryByRole('button', { name: implementButton })).not.toBeInTheDocument();
      },
    );
  });

  describe('manual controls (fallback)', () => {
    beforeEach(() => {
      mockUpdateCodeState.mockResolvedValue({
        factory_state: 'in_refinement',
        blocked_reason: null,
        updated_at: '2025-02-02T00:00:00Z',
      } as never);
    });

    it('Advance one step targets the next happy-path state', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'needs_refinement' }));

      await user.click(dialog.getByRole('button', { name: /advance/i }));

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_refinement', {});
    });

    it('Revert one step targets the previous happy-path state', async () => {
      const user = userEvent.setup();
      const { dialog } = renderModal(makeStory({ factory_state: 'ready_for_dev' }));

      await user.click(dialog.getByRole('button', { name: /revert/i }));

      expect(mockUpdateCodeState).toHaveBeenCalledWith('ALF-42', 'in_refinement', {});
    });

    it('disables Revert at the first state and Advance at the last', () => {
      const first = renderModal(makeStory({ factory_state: 'needs_refinement' }));
      expect(first.dialog.getByRole('button', { name: /revert/i })).toBeDisabled();
      first.unmount();

      const last = renderModal(makeStory({ factory_state: 'done' }));
      expect(last.dialog.getByRole('button', { name: /advance/i })).toBeDisabled();
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
  });
});
