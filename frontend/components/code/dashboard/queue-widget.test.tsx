import { screen, within } from '@testing-library/react';
import { UserCheck } from 'lucide-react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import type { CodeStory, Project } from '@/lib/types';

import { QUEUE_WIDGET_ROWS, QueueWidget } from './queue-widget';

const PROJECT: Project = {
  description: null,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 9,
  created_at: '2025-01-01T00:00:00Z',
};

function makeStory(index: number, overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: `i${String(index)}`,
    project_id: 'p1',
    epic_id: null,
    ref_number: index,
    ref: `ALF-${String(index)}`,
    factory_state: 'in_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: true,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: `Story ${String(index)}`,
    notes: null,
    priority: index,
    item_created_at: '2025-01-01T00:00:00Z',
    project_name: 'Alfred',
    project_key: 'ALF',
    epic_name: null,
    epic_ref: null,
    epic_archived_at: null,
    epic_spec_path: null,
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    source_url: null,
    ...overrides,
  };
}

function renderWidget(stories: CodeStory[]) {
  return renderWithProviders(
    <QueueWidget
      title="Needs human action"
      icon={UserCheck}
      stories={stories}
      href="/code/needs-human-action"
      emptyMessage="Nothing needs your attention right now."
    />,
    { projects: [PROJECT], stories },
  );
}

describe('QueueWidget', () => {
  it('shows at most five stories, in the order the queue ranks them', () => {
    renderWidget(Array.from({ length: 9 }, (_, index) => makeStory(index + 1)));

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(QUEUE_WIDGET_ROWS);
    expect(rows.map((row) => within(row).getByText(/^ALF-/).textContent)).toStrictEqual([
      'ALF-1',
      'ALF-2',
      'ALF-3',
      'ALF-4',
      'ALF-5',
    ]);
  });

  it('counts the WHOLE queue, not the rows drawn — the pane says how much it hides', () => {
    renderWidget(Array.from({ length: 23 }, (_, index) => makeStory(index + 1)));

    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.queryByText(String(QUEUE_WIDGET_ROWS))).not.toBeInTheDocument();
  });

  it('links its header to the full page', () => {
    renderWidget([makeStory(1)]);

    expect(screen.getByRole('link', { name: /needs human action/i })).toHaveAttribute(
      'href',
      '/code/needs-human-action',
    );
  });

  it('links each row to that story’s detail modal on its board', () => {
    renderWidget([makeStory(7)]);

    expect(screen.getByRole('link', { name: /ALF-7/ })).toHaveAttribute(
      'href',
      '/code/p1?story=ALF-7',
    );
  });

  it('shows the ref, the title and the factory-state chip — and no project key pill', () => {
    renderWidget([makeStory(7, { title: 'Surface a broken Gmail account' })]);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('ALF-7')).toBeInTheDocument();
    expect(within(row).getByText('Surface a broken Gmail account')).toBeInTheDocument();
    expect(within(row).getByText('In Refinement')).toBeInTheDocument();
    // The ref already OPENS with the project key; a pill would print ALF twice on one line.
    expect(within(row).queryByText('ALF')).not.toBeInTheDocument();
  });

  it('tints the ref with its project’s colour, which carries the project signal instead', () => {
    renderWidget([makeStory(7)]);

    // The first project in creation order wears the palette's first colour (ALF-50).
    expect(screen.getByText('ALF-7')).toHaveClass('text-accent-blue');
  });

  it('truncates a long title rather than breaking the two-up layout', () => {
    renderWidget([makeStory(1, { title: 'A title long enough to overflow a half-width pane' })]);

    expect(screen.getByText('A title long enough to overflow a half-width pane')).toHaveClass(
      'truncate',
    );
  });

  it('replaces the list with its empty message on an empty queue, keeping the pane', () => {
    renderWidget([]);

    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    // The header — and so the count and the link into the page — survives.
    expect(screen.getByRole('link', { name: /needs human action/i })).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
