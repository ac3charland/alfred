import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import type { Project } from '@/lib/types';

import { ProjectKeyChip } from './project-key-chip';

const ALFRED: Project = {
  id: 'p-alf',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 0,
  created_at: '2025-01-01T00:00:00Z',
};

describe('ProjectKeyChip', () => {
  it('renders the assigned project’s key', () => {
    renderWithProviders(<ProjectKeyChip projectId="p-alf" />, { projects: [ALFRED] });
    expect(screen.getByText('ALF')).toBeInTheDocument();
  });

  it('tints the chip with the project’s positional colour (first project = blue)', () => {
    renderWithProviders(<ProjectKeyChip projectId="p-alf" />, { projects: [ALFRED] });
    expect(screen.getByText('ALF')).toHaveClass('text-accent-blue');
  });

  it('renders nothing when the project is not in the store', () => {
    renderWithProviders(<ProjectKeyChip projectId="missing" />, { projects: [ALFRED] });
    expect(screen.queryByText('ALF')).not.toBeInTheDocument();
  });
});
