import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { Project } from '@/lib/types';

import { ProjectFilterMenu } from './project-filter-menu';

function makeProject(id: string, name: string, key: string): Project {
  return {
    description: null,
    id,
    name,
    key,
    repo_owner: 'ac3charland',
    repo_name: name.toLowerCase(),
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  };
}

const PROJECTS: Project[] = [makeProject('p1', 'Alfred', 'ALF'), makeProject('p2', 'Relay', 'RLP')];

/** The resting selection (ALF-201): nothing picked out, so the Backlog lists every project. */
const NONE: string[] = [];

describe('ProjectFilterMenu', () => {
  it('labels the trigger and shows no count at the resting (nothing-selected) state', () => {
    render(
      <ProjectFilterMenu
        projects={PROJECTS}
        selected={NONE}
        onToggle={jest.fn()}
        isFiltering={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter by project' })).toBeInTheDocument();
  });

  it('shows the selected count on the trigger while filtering', () => {
    render(
      <ProjectFilterMenu projects={PROJECTS} selected={['p1']} onToggle={jest.fn()} isFiltering />,
    );
    expect(screen.getByRole('button', { name: 'Filter by project (1)' })).toBeInTheDocument();
  });

  it('renders one checkbox per project, named by the project and checked per the selection', async () => {
    const user = userEvent.setup();
    render(
      <ProjectFilterMenu projects={PROJECTS} selected={['p2']} onToggle={jest.fn()} isFiltering />,
    );

    await user.click(screen.getByRole('button', { name: /filter by project/i }));
    await screen.findByRole('menu');

    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(2);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Alfred' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Relay' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reports the toggled project id to the caller', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    render(
      <ProjectFilterMenu
        projects={PROJECTS}
        selected={NONE}
        onToggle={onToggle}
        isFiltering={false}
      />,
    );

    // Radix portals set pointer-events:none on the body, so drive the menu by keyboard.
    await user.click(screen.getByRole('button', { name: /filter by project/i }));
    await screen.findByRole('menu');
    await user.keyboard('[ArrowDown][Enter]');

    expect(onToggle).toHaveBeenCalledWith('p1');
  });

  it('tints each project glyph with that project’s palette colour (ALF-50)', async () => {
    const user = userEvent.setup();
    render(
      <ProjectFilterMenu
        projects={PROJECTS}
        selected={NONE}
        onToggle={jest.fn()}
        isFiltering={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: /filter by project/i }));
    await screen.findByRole('menu');

    // Colour is the project's stable creation slot: #1 blue, #2 amber (project-color.ts).
    expect(screen.getByRole('menuitemcheckbox', { name: 'Alfred' }).innerHTML).toContain(
      'text-accent-blue',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Relay' }).innerHTML).toContain(
      'text-accent-amber',
    );
  });
});
