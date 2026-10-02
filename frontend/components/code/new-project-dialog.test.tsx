import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { Project } from '@/lib/types';

import { NewProjectDialog } from './new-project-dialog';

/** A minimal reconciled project the resolved `onCreateProject` hands back. */
const CREATED = { id: 'p9', key: 'RLP' } as Project;

function renderDialog() {
  const onCreateProject = jest.fn().mockResolvedValue(CREATED);
  render(
    <NewProjectDialog
      open
      onOpenChange={jest.fn()}
      onCreateProject={onCreateProject}
      onCreated={jest.fn()}
      existingKeys={['ALF']}
    />,
  );
  return { onCreateProject };
}

/** Fill the three required fields with a valid RealPlay project. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'RealPlay');
  await user.type(screen.getByLabelText('GitHub link'), 'https://github.com/ac3charland/realplay');
  await user.type(screen.getByLabelText('Ticket key'), 'rlp');
}

describe('NewProjectDialog — the cloud environment (ALF-279)', () => {
  it('offers an optional cloud environment field', () => {
    renderDialog();
    expect(screen.getByLabelText(/cloud environment/i)).toHaveValue('');
  });

  it('sends the trimmed environment with the new project', async () => {
    const user = userEvent.setup();
    const { onCreateProject } = renderDialog();

    await fillRequired(user);
    await user.type(screen.getByLabelText(/cloud environment/i), '  RealPlay  ');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => {
      expect(onCreateProject).toHaveBeenCalledWith({
        name: 'RealPlay',
        github_url: 'https://github.com/ac3charland/realplay',
        key: 'RLP',
        cloud_environment: 'RealPlay',
      });
    });
  });

  it('sends no environment when the field is left blank', async () => {
    const user = userEvent.setup();
    const { onCreateProject } = renderDialog();

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => {
      expect(onCreateProject).toHaveBeenCalledWith({
        name: 'RealPlay',
        github_url: 'https://github.com/ac3charland/realplay',
        key: 'RLP',
      });
    });
  });
});
