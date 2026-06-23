import { render, screen, waitFor } from '@testing-library/react';
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

    // The card body opens the detail modal; query by its accessible name to disambiguate it
    // from the launch button that also renders in this state.
    await user.click(screen.getByRole('button', { name: /open ALF-42/i }));

    expect(onOpen).toHaveBeenCalledWith(story);
  });

  it('renders without an onOpen handler (the click is a no-op)', async () => {
    const user = userEvent.setup();
    render(<StoryCard story={makeStory()} />);

    // No throw on click when onOpen is absent.
    const body = screen.getByRole('button', { name: /open ALF-42/i });
    await user.click(body);
    expect(body).toBeInTheDocument();
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

    expect(screen.getAllByRole('button')[0]).toHaveAttribute('data-factory-state', 'ready_for_dev');
  });

  describe('the "Open Claude Code" action', () => {
    /** The set of states in which NO launch button applies. */
    const noButtonStates = [
      'in_refinement',
      'in_development',
      'ready_for_review',
      'done',
      'blocked',
      'abandoned',
    ] as const;

    it('shows a Refinement button when the story needs refinement', () => {
      render(<StoryCard story={makeStory({ factory_state: 'needs_refinement' })} />);

      expect(screen.getByRole('button', { name: /refine/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /implement/i })).not.toBeInTheDocument();
    });

    it('shows both Refine and the subordinate Skip to Development in needs_refinement, in that order', () => {
      render(<StoryCard story={makeStory({ factory_state: 'needs_refinement' })} />);

      const launches = screen.getAllByRole('button', { name: /claude code|skip to development/i });
      expect(launches.map((button) => button.textContent)).toEqual([
        'Refine in Claude Code',
        'Skip to Development',
      ]);
    });

    it('offers no Skip to Development outside needs_refinement', () => {
      render(<StoryCard story={makeStory({ factory_state: 'ready_for_dev' })} />);

      expect(
        screen.queryByRole('button', { name: /skip to development/i }),
      ).not.toBeInTheDocument();
    });

    it('calls onOpenSession with the bypass phase when Skip to Development is clicked', async () => {
      const onOpenSession = jest.fn(() => Promise.resolve());
      const story = makeStory({ factory_state: 'needs_refinement' });
      const user = userEvent.setup();
      render(<StoryCard story={story} onOpenSession={onOpenSession} />);

      await user.click(screen.getByRole('button', { name: /skip to development/i }));

      expect(onOpenSession).toHaveBeenCalledWith(story, 'bypass');
    });

    it('shows an Implementation button when the story is ready for dev', () => {
      render(<StoryCard story={makeStory({ factory_state: 'ready_for_dev' })} />);

      expect(screen.getByRole('button', { name: /implement/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /refine/i })).not.toBeInTheDocument();
    });

    it.each(noButtonStates)('shows no launch button in the %s state', (state) => {
      render(<StoryCard story={makeStory({ factory_state: state })} />);

      expect(screen.queryByRole('button', { name: /refine/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /implement/i })).not.toBeInTheDocument();
    });

    it('calls onOpenSession with the story and the refinement phase', async () => {
      const onOpenSession = jest.fn(() => Promise.resolve());
      const story = makeStory({ factory_state: 'needs_refinement' });
      const user = userEvent.setup();
      render(<StoryCard story={story} onOpenSession={onOpenSession} />);

      await user.click(screen.getByRole('button', { name: /refine/i }));

      expect(onOpenSession).toHaveBeenCalledWith(story, 'refinement');
    });

    it('calls onOpenSession with the implementation phase from ready_for_dev', async () => {
      const onOpenSession = jest.fn(() => Promise.resolve());
      const story = makeStory({ factory_state: 'ready_for_dev' });
      const user = userEvent.setup();
      render(<StoryCard story={story} onOpenSession={onOpenSession} />);

      await user.click(screen.getByRole('button', { name: /implement/i }));

      expect(onOpenSession).toHaveBeenCalledWith(story, 'implementation');
    });

    it('does not fire the card-level onOpen when the launch button is clicked', async () => {
      const onOpen = jest.fn();
      const onOpenSession = jest.fn(() => Promise.resolve());
      const user = userEvent.setup();
      render(
        <StoryCard
          story={makeStory({ factory_state: 'needs_refinement' })}
          onOpen={onOpen}
          onOpenSession={onOpenSession}
        />,
      );

      await user.click(screen.getByRole('button', { name: /refine/i }));

      expect(onOpenSession).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('shows a spinner while the launch is in flight and disables the button', async () => {
      // A never-resolving handler keeps the launch pending so the spinner stays visible.
      const onOpenSession = jest.fn().mockImplementation(() => new Promise(() => {}));
      const user = userEvent.setup();
      render(
        <StoryCard
          story={makeStory({ factory_state: 'needs_refinement' })}
          onOpenSession={onOpenSession}
        />,
      );

      const launch = screen.getByRole('button', { name: /refine/i });
      await user.click(launch);

      // The spinner has an accessible "Opening" label (queried by name to avoid the toast
      // viewport's status-region collision, per the RTL skill).
      expect(await screen.findByRole('status', { name: /opening/i })).toBeInTheDocument();
      expect(launch).toBeDisabled();
    });

    it('re-enables the button after a failed launch (so the user can retry)', async () => {
      const onOpenSession = jest.fn().mockRejectedValue(new Error('write failed'));
      const user = userEvent.setup();
      render(
        <StoryCard
          story={makeStory({ factory_state: 'needs_refinement' })}
          onOpenSession={onOpenSession}
        />,
      );

      const launch = screen.getByRole('button', { name: /refine/i });
      await user.click(launch);

      // Settles back to enabled; the spinner is gone.
      await waitFor(() => {
        expect(launch).toBeEnabled();
      });
      expect(screen.queryByRole('status', { name: /opening/i })).not.toBeInTheDocument();
    });
  });
});
