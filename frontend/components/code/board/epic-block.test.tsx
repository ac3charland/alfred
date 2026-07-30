import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as api from '@/lib/api-client';
import { CodeProvider } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { EpicBlock } from './epic-block';

// react-markdown (and remark-gfm) are pure ESM; jest's default transform ignores node_modules, so
// importing the real package throws "Unexpected token 'export'". The spec modal mounted below
// pulls them in transitively — mock the seam, rendering the source into a real container. This
// mocks the dependency, it does not weaken config.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

// The store's actions call the api-client; mock it so nothing hits the network. The epic launch
// writes no state, so these mocks exist only to catch a write that shouldn't happen.
jest.mock('@/lib/api-client');
const mockUpdateEpic = jest.mocked(api.updateEpic);

// The clipboard paste-fallback: stub it so the launch resolves under jsdom.
const mockCopyToClipboard = jest.fn<Promise<boolean>, [string]>();
jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: (text: string) => mockCopyToClipboard(text),
}));

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 12,
  created_at: '2025-01-01T00:00:00Z',
};

function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: 'e1',
    project_id: 'p1',
    name: 'Communication Firewall',
    notes: null,
    ref_number: 12,
    ref: 'ALF-12',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    ...overrides,
  };
}

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
    factory_state: 'abandoned',
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
    title: 'Retire the legacy importer',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Communication Firewall',
    epic_ref: 'ALF-12',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

/** Render one epic block with an empty (but well-formed) board for that epic. */
function renderEpicBlock(
  epic: Epic,
  boardOverrides: { abandonedStories?: CodeStory[]; blockedCount?: number } = {},
  properties: { showAbandoned?: boolean } = {},
) {
  const board = {
    epic,
    lanes: [] as { state: never; label: string; stories: CodeStory[] }[],
    abandonedStories: boardOverrides.abandonedStories ?? [],
    blockedCount: boardOverrides.blockedCount ?? 0,
  };
  return render(
    <ToastProvider>
      <CodeProvider initialProjects={[PROJECT]} initialEpics={[epic]} initialStories={[]}>
        <EpicBlock
          board={board}
          collapsed={false}
          onToggleCollapse={jest.fn()}
          visibleStates={[]}
          showAbandoned={properties.showAbandoned ?? false}
          onOpenStory={jest.fn()}
          onOpenSession={jest.fn()}
        />
      </CodeProvider>
    </ToastProvider>,
  );
}

let openSpy: jest.SpiedFunction<typeof globalThis.open>;
beforeEach(() => {
  mockCopyToClipboard.mockResolvedValue(true);
  openSpy = jest.spyOn(globalThis, 'open').mockImplementation(() => null);
});
afterEach(() => {
  openSpy.mockRestore();
});

describe('EpicBlock — the blocked badge (ALF-136)', () => {
  it('badges the epic header with its blocked-story count', () => {
    renderEpicBlock(makeEpic(), { blockedCount: 3 });

    expect(screen.getByText('3 blocked')).toBeInTheDocument();
  });

  it('singularises the count for one blocked story', () => {
    renderEpicBlock(makeEpic(), { blockedCount: 1 });

    expect(screen.getByText('1 blocked')).toBeInTheDocument();
  });

  it('shows no badge when nothing in the epic is blocked', () => {
    renderEpicBlock(makeEpic(), { blockedCount: 0 });

    expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
  });

  it('keeps the badge visible while the epic is collapsed', () => {
    // The badge replaces the old Show-blocked toggle as the at-a-glance signal, so it has to
    // survive collapse — that is the case where the lanes themselves are hidden.
    render(
      <ToastProvider>
        <CodeProvider initialProjects={[PROJECT]} initialEpics={[]} initialStories={[]}>
          <EpicBlock
            board={{ epic: makeEpic(), lanes: [], abandonedStories: [], blockedCount: 2 }}
            collapsed
            onToggleCollapse={jest.fn()}
            visibleStates={[]}
            showAbandoned={false}
            onOpenStory={jest.fn()}
            onOpenSession={jest.fn()}
          />
        </CodeProvider>
      </ToastProvider>,
    );

    expect(screen.getByText('2 blocked')).toBeInTheDocument();
  });
});

describe('EpicBlock — the abandoned section (ALF-136)', () => {
  it('hides abandoned stories until Show abandoned is on', () => {
    renderEpicBlock(makeEpic(), { abandonedStories: [makeStory()] }, { showAbandoned: false });

    expect(screen.queryByText('Retire the legacy importer')).not.toBeInTheDocument();
  });

  it('reveals them under an "Abandoned" heading when it is on', () => {
    renderEpicBlock(makeEpic(), { abandonedStories: [makeStory()] }, { showAbandoned: true });

    expect(screen.getByRole('heading', { name: /abandoned/i })).toBeInTheDocument();
    expect(screen.getByText('Retire the legacy importer')).toBeInTheDocument();
  });

  it('renders no heading when the epic has no abandoned stories', () => {
    renderEpicBlock(makeEpic(), { abandonedStories: [] }, { showAbandoned: true });

    expect(screen.queryByRole('heading', { name: /abandoned/i })).not.toBeInTheDocument();
  });
});

describe('EpicBlock — the 3-dot menu', () => {
  it('offers "Refine epic in Claude Code" on an epic with no spec', async () => {
    const user = userEvent.setup();
    renderEpicBlock(makeEpic());

    await user.click(screen.getByRole('button', { name: /epic actions/i }));

    expect(
      screen.getByRole('menuitem', { name: /refine epic in claude code/i }),
    ).toBeInTheDocument();
  });

  it('offers it on an ARCHIVED epic too', async () => {
    const user = userEvent.setup();
    renderEpicBlock(makeEpic({ archived_at: '2026-01-01T00:00:00Z' }));

    await user.click(screen.getByRole('button', { name: /epic actions/i }));

    expect(
      screen.getByRole('menuitem', { name: /refine epic in claude code/i }),
    ).toBeInTheDocument();
  });

  it('opens the prefilled epic-refinement tab and copies the prompt, writing no state', async () => {
    const user = userEvent.setup();
    renderEpicBlock(makeEpic());

    await user.click(screen.getByRole('button', { name: /epic actions/i }));
    await user.click(screen.getByRole('menuitem', { name: /refine epic in claude code/i }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    const opened = String(openSpy.mock.calls[0]?.[0] ?? '');
    expect(opened).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
    const prompt = new URL(opened).searchParams.get('q') ?? '';
    expect(prompt).toContain('ALF-12: Communication Firewall');
    expect(prompt).toContain('phase: epic-refinement');
    expect(mockCopyToClipboard).toHaveBeenCalledWith(prompt);
    // The epic has no lifecycle — the launch must not PATCH the epic.
    expect(mockUpdateEpic).not.toHaveBeenCalled();
  });

  it('hides "View spec" until the epic has a recorded spec path', async () => {
    const user = userEvent.setup();
    renderEpicBlock(makeEpic());

    await user.click(screen.getByRole('button', { name: /epic actions/i }));

    expect(screen.queryByRole('menuitem', { name: /view spec/i })).not.toBeInTheDocument();
  });

  it('shows "View spec" once a spec exists and opens the spec modal', async () => {
    const user = userEvent.setup();
    renderEpicBlock(
      makeEpic({
        spec_path: 'docs/specs/epics/ALF-12.html',
        spec_markdown: '# Epic plan\n\nThe decisions.',
      }),
    );

    await user.click(screen.getByRole('button', { name: /epic actions/i }));
    await user.click(screen.getByRole('menuitem', { name: /view spec/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('ALF-12');
    expect(dialog).toHaveTextContent('Communication Firewall');
    expect(screen.getByTestId('spec-markdown')).toHaveTextContent('Epic plan');
  });

  it('keeps Archive last, below the separator', async () => {
    const user = userEvent.setup();
    renderEpicBlock(makeEpic({ spec_path: 'docs/specs/epics/ALF-12.html' }));

    await user.click(screen.getByRole('button', { name: /epic actions/i }));

    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).toEqual([
      'Edit title',
      'Refine epic in Claude Code',
      'View spec',
      expect.stringMatching(/archive/i),
    ]);
  });

  it('hides the whole menu while the title is being renamed', async () => {
    const user = userEvent.setup();
    renderEpicBlock(makeEpic());

    await user.click(screen.getByRole('button', { name: /epic actions/i }));
    await user.click(screen.getByRole('menuitem', { name: /edit title/i }));

    expect(screen.queryByRole('button', { name: /epic actions/i })).not.toBeInTheDocument();
  });
});
