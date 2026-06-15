import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';

import { ProjectNav } from './project-nav';

const mockPathname = jest.fn<string, []>(() => '/code');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

beforeEach(() => {
  jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

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

  it('does not defer the New project control into the DOM (M4 seam)', () => {
    // The create control is deferred to M4; ProjectNav must not render a create button yet.
    renderNav(PROJECTS);

    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument();
  });
});
