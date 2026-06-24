import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { CodeStory } from '@/lib/types';

import { BacklogRow } from './backlog-row';

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
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
    title: 'Wire the backlog',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Refinement',
    epic_ref: 'ALF-3',
    epic_archived_at: null,
    priority: 1,
    ...overrides,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof BacklogRow>> = {}) {
  const onReorder = jest.fn();
  render(
    <ul>
      <BacklogRow
        story={makeStory()}
        prevRef="ALF-0"
        nextRef="ALF-2"
        onReorder={onReorder}
        {...props}
      />
    </ul>,
  );
  return { onReorder };
}

describe('BacklogRow', () => {
  it('shows the ref, title, project + epic badges, and a status chip for the factory state', () => {
    renderRow();
    expect(screen.getByText('ALF-1')).toBeInTheDocument();
    expect(screen.getByText('Wire the backlog')).toBeInTheDocument();
    expect(screen.getByText('Alfred')).toBeInTheDocument();
    expect(screen.getByText('Refinement')).toBeInTheDocument();
    expect(screen.getByText('ALF-3')).toBeInTheDocument();
    // The status chip is labelled for EVERY state — here a happy-path one.
    expect(screen.getByText('In Development')).toBeInTheDocument();
  });

  it('links the body to the story modal in its project board', () => {
    renderRow();
    expect(screen.getByRole('link', { name: /Open ALF-1/ })).toHaveAttribute(
      'href',
      '/code/p1?story=ALF-1',
    );
  });

  it('disables Up at the top and Down at the bottom', () => {
    renderRow({ prevRef: null });
    expect(screen.getByRole('button', { name: 'Move ALF-1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-1 down' })).toBeEnabled();
  });

  it('swaps with the previous neighbour on Up and the next on Down', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Move ALF-1 up' }));
    expect(onReorder).toHaveBeenCalledWith('ALF-1', 'ALF-0');

    await user.click(screen.getByRole('button', { name: 'Move ALF-1 down' }));
    expect(onReorder).toHaveBeenCalledWith('ALF-1', 'ALF-2');
  });
});
