import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { CodeStory } from '@/lib/types';

import { StoryCard } from './story-card';

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
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
    title: 'Wire up the webhook',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Plumbing',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    ...overrides,
  };
}

describe('StoryCard', () => {
  it('shows the ref and title', () => {
    render(<StoryCard story={makeStory()} />);

    expect(screen.getByText('ALF-42')).toBeInTheDocument();
    expect(screen.getByText('Wire up the webhook')).toBeInTheDocument();
  });

  it('is an activatable button and calls onOpen with the story when clicked', async () => {
    const onOpen = jest.fn();
    const story = makeStory();
    const user = userEvent.setup();
    render(<StoryCard story={story} onOpen={onOpen} />);

    await user.click(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledWith(story);
  });

  it('renders without an onOpen handler (the click is a no-op)', async () => {
    const user = userEvent.setup();
    render(<StoryCard story={makeStory()} />);

    // No throw on click when onOpen is absent.
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows no escape tag for a happy-path story', () => {
    render(<StoryCard story={makeStory({ factory_state: 'in_development' })} />);

    expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/abandoned/i)).not.toBeInTheDocument();
  });

  it('marks a blocked story with a Blocked tag', () => {
    render(<StoryCard story={makeStory({ factory_state: 'blocked' })} />);

    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('marks an abandoned story with an Abandoned tag', () => {
    render(<StoryCard story={makeStory({ factory_state: 'abandoned' })} />);

    expect(screen.getByText('Abandoned')).toBeInTheDocument();
  });

  it('exposes the factory state as a data attribute for the board', () => {
    render(<StoryCard story={makeStory({ factory_state: 'ready_for_dev' })} />);

    expect(screen.getByRole('button')).toHaveAttribute('data-factory-state', 'ready_for_dev');
  });
});
