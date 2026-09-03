import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import type { Item } from '@/lib/types';

import { InboxEyebrow } from './inbox-eyebrow';

const BASE_ITEM: Item = {
  id: 'item-1',
  title: 'Parent task',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
  weekly_plan_id: null,
};

const item = (id: string, overrides: Partial<Item> = {}): Item => ({
  ...BASE_ITEM,
  id,
  title: `Task ${id}`,
  ...overrides,
});

describe('InboxEyebrow', () => {
  it('shows the tally in parentheses beside the label', () => {
    renderWithProviders(<InboxEyebrow />, { tasks: [item('a'), item('b')] });

    expect(screen.getByText('Inbox (2)')).toBeInTheDocument();
  });

  it('shows a bare label with no "(0)" when the inbox is empty', () => {
    renderWithProviders(<InboxEyebrow />, { tasks: [] });

    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.queryByText(/\(0\)/)).not.toBeInTheDocument();
  });

  it('counts the rows the list renders — not the subtasks nested under them', () => {
    renderWithProviders(<InboxEyebrow />, {
      tasks: [item('a'), item('a-child', { parent_id: 'a' }), item('b')],
    });

    expect(screen.getByText('Inbox (2)')).toBeInTheDocument();
  });

  it('excludes dispatched items — they have left the inbox for a folder', () => {
    renderWithProviders(<InboxEyebrow />, {
      tasks: [
        item('a'),
        item('filed', { folder_id: 'f-work', dispatched_at: '2025-01-02T09:00:00Z' }),
      ],
    });

    expect(screen.getByText('Inbox (1)')).toBeInTheDocument();
  });

  it('excludes completed roots — they belong to the Completed view', () => {
    renderWithProviders(<InboxEyebrow />, {
      tasks: [
        item('a'),
        item('done', { status: 'completed', completed_at: '2025-01-02T09:00:00Z' }),
      ],
    });

    expect(screen.getByText('Inbox (1)')).toBeInTheDocument();
  });
});
