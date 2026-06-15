import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeProvider } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

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

function renderNav(projects: Project[], properties: Partial<{ onClose: () => void }> = {}) {
  const onCloseProperty = properties.onClose ? { onClose: properties.onClose } : {};
  return render(
    <CodeProvider initialProjects={projects} initialEpics={[]} initialStories={[]}>
      <ProjectNav {...onCloseProperty} />
    </CodeProvider>,
  );
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

  it('lists each project as a link with its key', () => {
    renderNav(PROJECTS);

    expect(screen.getByRole('link', { name: /alfred/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /relay/i })).toBeInTheDocument();
    expect(screen.getByText('ALF')).toBeInTheDocument();
    expect(screen.getByText('RLP')).toBeInTheDocument();
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

  it('renders the New project button (§9.1)', () => {
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
