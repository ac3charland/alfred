import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { CodeProvider } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { Project } from '@/lib/types';

import { type EpicGateChild, EpicGateDialog, type EpicGateParent } from './epic-gate-dialog';

// The epic gate routes the conversion through the code store's convertToCodeEpic, which
// calls api-client under the hood. Mock that seam; seed the project list via CodeProvider.
jest.mock('@/lib/api-client');
const mockConvertToCodeEpic = jest.mocked(api.convertToCodeEpic);

const PARENT: EpicGateParent = { id: 'parent-1', title: 'Construction inbox', notes: null };
const CHILDREN: EpicGateChild[] = [
  { id: 'c-1', title: 'Add plus button', notes: null, source_url: null },
  { id: 'c-2', title: 'Only allow 1-deep', notes: null, source_url: null },
  { id: 'c-3', title: 'Convert on send', notes: null, source_url: null },
];

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 0,
  created_at: '2025-01-01T00:00:00Z',
};

const CONVERTED: api.ConvertedEpic = {
  epic: {
    id: 'server-epic',
    project_id: 'p1',
    name: 'Construction inbox',
    notes: null,
    ref_number: 40,
    ref: 'ALF-40',
    archived_at: null,
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    created_at: '2025-01-02T00:00:00Z',
  },
  stories: [],
};

function renderEpicGate(overrides: Partial<React.ComponentProps<typeof EpicGateDialog>> = {}) {
  const onComplete = overrides.onComplete ?? jest.fn();
  const onOpenChange = overrides.onOpenChange ?? jest.fn();
  render(
    <ToastProvider>
      <CodeProvider initialProjects={[PROJECT]} initialEpics={[]} initialStories={[]}>
        <EpicGateDialog
          open
          onOpenChange={onOpenChange}
          parent={overrides.parent ?? PARENT}
          childItems={overrides.childItems ?? CHILDREN}
          onComplete={onComplete}
        />
      </CodeProvider>
    </ToastProvider>,
  );
  return { onComplete, onOpenChange };
}

describe('EpicGateDialog', () => {
  it('describes what it creates and previews the epic name + ordered story titles', async () => {
    renderEpicGate();

    expect(
      await screen.findByText(/creates a new epic and 3 stories at the top/i),
    ).toBeInTheDocument();
    const preview = screen.getByTestId('epic-gate-preview');
    expect(preview).toHaveTextContent('Construction inbox');
    const titles = within(preview)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(titles).toEqual(['Add plus button', 'Only allow 1-deep', 'Convert on send']);
  });

  it('uses the singular for a one-story epic', async () => {
    renderEpicGate({ childItems: CHILDREN.slice(0, 1) });
    expect(await screen.findByText(/creates a new epic and 1 story at the top/i)).toBeVisible();
  });

  it('offers no epic picker — the epic is being created', async () => {
    renderEpicGate();
    await screen.findByRole('option', { name: /alfred/i });
    expect(screen.queryByRole('listbox', { name: /epic/i })).toBeNull();
  });

  it('disables Confirm until a project is chosen, then converts and completes', async () => {
    mockConvertToCodeEpic.mockResolvedValue(CONVERTED);
    const user = userEvent.setup();
    const { onComplete, onOpenChange } = renderEpicGate();

    const confirm = screen.getByRole('button', { name: /^send to code$/i });
    expect(confirm).toBeDisabled();

    await user.click(await screen.findByRole('option', { name: /alfred/i }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(mockConvertToCodeEpic).toHaveBeenCalledWith('parent-1', 'p1');
    });
    expect(onComplete).toHaveBeenCalledWith(CONVERTED);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a retryable error when the conversion fails (dialog stays open)', async () => {
    mockConvertToCodeEpic.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { onComplete, onOpenChange } = renderEpicGate();

    await user.click(await screen.findByRole('option', { name: /alfred/i }));
    await user.click(screen.getByRole('button', { name: /^send to code$/i }));

    expect(await screen.findByText(/could not send to the code module/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
