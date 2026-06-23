import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { BoardLane } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

import { Swimlane } from './swimlane';

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: 'ALF-1',
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
    title: 'A story',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Epic',
    epic_ref: 'ALF-0',
    epic_archived_at: null,
    priority: null,
    ...overrides,
  };
}

const LANE: BoardLane = {
  state: 'needs_refinement',
  label: 'Needs Refinement',
  stories: [
    makeStory({ item_id: 'i1', ref: 'ALF-1', title: 'First story' }),
    makeStory({ item_id: 'i2', ref: 'ALF-2', title: 'Second story' }),
  ],
};

describe('Swimlane', () => {
  it('renders the lane label as its accessible name', () => {
    render(<Swimlane lane={LANE} />);

    expect(screen.getByRole('region', { name: 'Needs Refinement' })).toBeInTheDocument();
  });

  it('shows the count of stories in the lane', () => {
    render(<Swimlane lane={LANE} />);

    const lane = screen.getByRole('region', { name: 'Needs Refinement' });
    expect(within(lane).getByText('2')).toBeInTheDocument();
  });

  it('renders a card per story showing ref + title', () => {
    render(<Swimlane lane={LANE} />);

    const lane = screen.getByRole('region', { name: 'Needs Refinement' });
    expect(within(lane).getByText('ALF-1')).toBeInTheDocument();
    expect(within(lane).getByText('First story')).toBeInTheDocument();
    expect(within(lane).getByText('ALF-2')).toBeInTheDocument();
    expect(within(lane).getByText('Second story')).toBeInTheDocument();
  });

  it('shows an empty placeholder when the lane has no stories', () => {
    render(<Swimlane lane={{ state: 'done', label: 'Done', stories: [] }} />);

    const lane = screen.getByRole('region', { name: 'Done' });
    expect(within(lane).getByText(/no stories/i)).toBeInTheDocument();
    expect(within(lane).getByText('0')).toBeInTheDocument();
  });

  it('forwards card activation to onOpenStory', async () => {
    const onOpenStory = jest.fn();
    const user = userEvent.setup();
    render(<Swimlane lane={LANE} onOpenStory={onOpenStory} />);

    const lane = screen.getByRole('region', { name: 'Needs Refinement' });
    await user.click(within(lane).getByText('First story'));

    expect(onOpenStory).toHaveBeenCalledWith(
      expect.objectContaining({ item_id: 'i1', ref: 'ALF-1' }),
    );
  });
});
