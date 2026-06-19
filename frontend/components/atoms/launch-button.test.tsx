import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CodeStory } from '@/lib/types';

import { LaunchButton } from './launch-button';

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

describe('LaunchButton', () => {
  it('renders the refine label in needs_refinement', () => {
    render(<LaunchButton story={makeStory({ factory_state: 'needs_refinement' })} />);

    expect(screen.getByRole('button', { name: /refine in claude code/i })).toBeInTheDocument();
  });

  it('renders the implement label in ready_for_dev', () => {
    render(<LaunchButton story={makeStory({ factory_state: 'ready_for_dev' })} />);

    expect(screen.getByRole('button', { name: /implement in claude code/i })).toBeInTheDocument();
  });

  it('renders nothing in a non-launchable state', () => {
    const { container } = render(<LaunchButton story={makeStory({ factory_state: 'blocked' })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('calls onOpenSession with the story and derived phase when clicked', async () => {
    const onOpenSession = jest.fn();
    const story = makeStory({ factory_state: 'ready_for_dev' });
    const user = userEvent.setup();
    render(<LaunchButton story={story} onOpenSession={onOpenSession} />);

    await user.click(screen.getByRole('button', { name: /implement in claude code/i }));

    expect(onOpenSession).toHaveBeenCalledWith(story, 'implementation');
  });

  it('re-enables after a failed launch settles', async () => {
    const onOpenSession = jest.fn().mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    render(
      <LaunchButton
        story={makeStory({ factory_state: 'needs_refinement' })}
        onOpenSession={onOpenSession}
      />,
    );

    await user.click(screen.getByRole('button', { name: /refine in claude code/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refine in claude code/i })).not.toBeDisabled();
    });
  });

  it('chip variant renders the bordered teal chip chrome', () => {
    render(<LaunchButton story={makeStory()} variant="chip" />);

    expect(screen.getByRole('button', { name: /refine in claude code/i })).toHaveClass(
      'rounded-md',
      'border-accent-teal/40',
      'bg-accent-teal/10',
    );
  });

  it('solid variant renders the accent Button chrome', () => {
    render(<LaunchButton story={makeStory()} variant="solid" />);

    expect(screen.getByRole('button', { name: /refine in claude code/i })).toHaveClass(
      'bg-accent-teal',
      'text-background',
    );
  });
});
