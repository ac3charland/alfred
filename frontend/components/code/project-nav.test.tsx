import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeProvider } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeStory, Epic, Project } from '@/lib/types';

import { ProjectNav } from './project-nav';

const mockPathname = jest.fn<string, []>(() => '/code');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// The New-project dialog persists via the optimistic createProject action, which calls
// api-client; mock it so the dialog's create flow never hits the network.
jest.mock('@/lib/api-client');
const mockCreateProject = jest.mocked(api.createProject);

beforeEach(() => {
  pushStateSpy = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

let pushStateSpy: jest.SpyInstance;

const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'p2',
    name: 'Relay',
    key: 'RLP',
    repo_owner: 'ac3charland',
    repo_name: 'relay',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-02T00:00:00Z',
  },
];

function renderNav(
  projects: Project[],
  properties: Partial<{ onClose: () => void; epics: Epic[]; stories: CodeStory[] }> = {},
) {
  const onCloseProperty = properties.onClose ? { onClose: properties.onClose } : {};
  return render(
    <ToastProvider>
      <CodeProvider
        initialProjects={projects}
        initialEpics={properties.epics ?? []}
        initialStories={properties.stories ?? []}
      >
        <ProjectNav {...onCloseProperty} />
      </CodeProvider>
    </ToastProvider>,
  );
}

/** A minimal epic for a project (only the fields the store reads to rank by story). */
function makeEpic(id: string, projectId: string): Epic {
  return {
    id,
    project_id: projectId,
    name: `Epic ${id}`,
    notes: null,
    ref_number: 1,
    ref: 'ALF-1',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
  };
}

/** A minimal code story carrying just the project/epic/priority/state the rank reads. */
function makeStory(
  itemId: string,
  epicId: string,
  projectId: string,
  overrides: Partial<CodeStory> = {},
): CodeStory {
  return {
    item_id: itemId,
    project_id: projectId,
    epic_id: epicId,
    ref_number: 1,
    ref: 'ALF-1',
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
    epic_name: `Epic ${epicId}`,
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    priority: 1,
    ...overrides,
  };
}

describe('ProjectNav', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/code');
  });

  it('renders a labelled Projects nav with a section heading', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('navigation', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('links the Backlog and Needs human action destinations at the top of the nav', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /backlog/i })).toHaveAttribute('href', '/code/backlog');
    expect(screen.getByRole('link', { name: /needs human action/i })).toHaveAttribute(
      'href',
      '/code/needs-human-action',
    );
  });

  it('highlights the Needs human action link only on its own route (ALF-103)', () => {
    mockPathname.mockReturnValue('/code/needs-human-action');
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /needs human action/i })).toHaveClass('bg-secondary');
    // The Backlog link (active for /code and /code/backlog) is not highlighted here.
    expect(screen.getByRole('link', { name: /^backlog$/i })).not.toHaveClass('bg-secondary');
  });

  it('lists each project as a link with its key', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /alfred/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /relay/i })).toBeInTheDocument();
    expect(screen.getByText('ALF')).toBeInTheDocument();
    expect(screen.getByText('RLP')).toBeInTheDocument();
  });

  it('tints each project icon and key pill with its assigned colour, in palette order (ALF-50)', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /alfred/i }).querySelector('svg')).toHaveClass(
      'text-accent-blue',
    );
    expect(screen.getByRole('link', { name: /relay/i }).querySelector('svg')).toHaveClass(
      'text-accent-amber',
    );
    // The key chip echoes the Backlog badge's tinted-pill treatment in the same project colour.
    expect(screen.getByText('ALF')).toHaveClass('bg-accent-blue/15', 'text-accent-blue');
    expect(screen.getByText('RLP')).toHaveClass('bg-accent-amber/15', 'text-accent-amber');
  });

  it('orders projects by their best outstanding story priority (ALF-49)', () => {
    // Relay (p2) holds the highest-ranked open story (priority 5) → it leads Alfred (p1, priority 20),
    // overriding the seed order in which Alfred comes first.
    renderNav(PROJECTS, {
      epics: [makeEpic('e1', 'p1'), makeEpic('eX', 'p2')],
      stories: [
        makeStory('i1', 'e1', 'p1', { priority: 20 }),
        makeStory('i2', 'eX', 'p2', { priority: 5 }),
      ],
    });

    const projectHrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/code/p'));
    expect(projectHrefs).toEqual(['/code/p2', '/code/p1']);
  });

  it('keeps each project colour keyed to creation order even when the rank reorders the list', () => {
    // Same setup as the ALF-49 ranking test: Relay (p2) leads in display order. Its colour must
    // still be amber (creation slot #2), and Alfred's still blue (slot #1) — the colour follows the
    // project's identity, not its shifting row position. Guards against keying colour off the rank.
    renderNav(PROJECTS, {
      epics: [makeEpic('e1', 'p1'), makeEpic('eX', 'p2')],
      stories: [
        makeStory('i1', 'e1', 'p1', { priority: 20 }),
        makeStory('i2', 'eX', 'p2', { priority: 5 }),
      ],
    });

    expect(screen.getByRole('link', { name: /relay/i }).querySelector('svg')).toHaveClass(
      'text-accent-amber',
    );
    expect(screen.getByRole('link', { name: /alfred/i }).querySelector('svg')).toHaveClass(
      'text-accent-blue',
    );
  });

  it('points each project link at /code/<id>', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /alfred/i })).toHaveAttribute('href', '/code/p1');
    expect(screen.getByRole('link', { name: /relay/i })).toHaveAttribute('href', '/code/p2');
  });

  it('highlights the project link for the active board route', () => {
    mockPathname.mockReturnValue('/code/p2');
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /relay/i })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /alfred/i })).not.toHaveClass('bg-secondary');
  });

  it('does not highlight any project on the bare /code landing route', () => {
    mockPathname.mockReturnValue('/code');
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /alfred/i })).not.toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /relay/i })).not.toHaveClass('bg-secondary');
  });

  it('shows an empty state and no project links when there are no projects', () => {
    renderNav([]);

    expect(screen.queryByRole('link', { name: /alfred/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });

  it('calls onClose when a project link is clicked', () => {
    const onClose = jest.fn();
    renderNav(PROJECTS, { onClose });

    screen.getByRole('link', { name: /alfred/i }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the New project button', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('opens the New-project dialog when the + is clicked', async () => {
    const user = userEvent.setup();
    renderNav(PROJECTS);

    await user.click(screen.getByRole('button', { name: /new project/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /github link/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /ticket key/i })).toBeInTheDocument();
  });

  it('creates a project and routes to its new board', async () => {
    // NB: the seeded PROJECTS already use ALF + RLP, so the new key must be distinct
    // (the dialog rejects a duplicate key — covered in gate-dialog.test).
    const created: Project = {
      id: 'p-new',
      name: 'Beacon',
      key: 'BCN',
      repo_owner: 'ac3charland',
      repo_name: 'beacon',
      github_url: 'https://github.com/ac3charland/beacon',
      ref_seq: 0,
      created_at: '2025-02-01T00:00:00Z',
    };
    mockCreateProject.mockResolvedValue(created);
    const user = userEvent.setup();
    renderNav(PROJECTS);

    await user.click(screen.getByRole('button', { name: /new project/i }));
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Beacon');
    await user.type(
      screen.getByRole('textbox', { name: /github link/i }),
      'https://github.com/ac3charland/beacon',
    );
    await user.type(screen.getByRole('textbox', { name: /ticket key/i }), 'BCN');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: 'Beacon',
        github_url: 'https://github.com/ac3charland/beacon',
        key: 'BCN',
      });
    });
    expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/code/p-new');
  });
});
