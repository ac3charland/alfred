import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as apiClient from '@/lib/api-client';
import { pinClock } from '@/lib/pin-clock';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { TodayView } from './today-view';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);

// Every due date below is written relative to this instant, so "today" never depends on the day
// the suite happens to run.
pinClock('2026-09-06T09:00:00');

const TODAY = '2026-09-06';
const YESTERDAY = '2026-09-05';
const LAST_WEEK = '2026-08-30';
const TOMORROW = '2026-09-07';

/** Fixed residency stamp for a seeded FILED item — fixtures pin the clock, never read it. */
const DISPATCHED_AT = '2026-01-01T00:00:00Z';

let nextCreated = 0;
function makeItem(title: string, overrides: Partial<Item> = {}): Item {
  nextCreated += 1;
  return {
    id: overrides.id ?? title,
    title,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: overrides.item_type ?? 'task',
    created_at: overrides.created_at ?? `2026-01-0${String(nextCreated)}T00:00:00Z`,
    due_date: overrides.due_date ?? null,
    status: overrides.status ?? 'active',
    completed_at: overrides.completed_at ?? null,
    folder_id: overrides.folder_id ?? null,
    dispatched_at:
      overrides.dispatched_at === undefined
        ? overrides.folder_id == null
          ? null
          : DISPATCHED_AT
        : overrides.dispatched_at,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: overrides.priority ?? null,
    recurrence: null,
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
}

function makeFolder(name: string, id: string): Folder {
  return { id, name, created_at: '2026-01-01T00:00:00Z', sort_order: 1, description: null };
}

/** The rendered top-level row text, in order, from the Today list. */
function rowOrder(): string[] {
  const list = screen.getByRole('list', { name: 'Tasks due today' });
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
}

describe('TodayView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists what is due today and what is already overdue, and nothing else', () => {
    renderWithProviders(<TodayView />, {
      tasks: [
        makeItem('Due today', { due_date: TODAY }),
        makeItem('Overdue', { due_date: YESTERDAY }),
        makeItem('Due tomorrow', { due_date: TOMORROW }),
        makeItem('Someday', { due_date: null }),
      ],
    });

    expect(screen.getByRole('link', { name: 'Due today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Due tomorrow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Someday' })).not.toBeInTheDocument();
  });

  it('puts the most overdue first, then today', () => {
    renderWithProviders(<TodayView />, {
      tasks: [
        makeItem('Today thing', { due_date: TODAY }),
        makeItem('A week late', { due_date: LAST_WEEK }),
        makeItem('A day late', { due_date: YESTERDAY }),
      ],
    });

    expect(rowOrder().map((text) => text.slice(0, 20))).toEqual([
      expect.stringContaining('A week late'),
      expect.stringContaining('A day late'),
      expect.stringContaining('Today thing'),
    ]);
  });

  it('ranks urgency above priority — an overdue Low beats a High due today', () => {
    renderWithProviders(<TodayView />, {
      tasks: [
        makeItem('High today', { due_date: TODAY, priority: 'high' }),
        makeItem('Low overdue', { due_date: YESTERDAY, priority: 'low' }),
      ],
    });

    const [first] = rowOrder();
    expect(first).toContain('Low overdue');
  });

  it('surfaces an undated parent whose subtask is due, without listing the subtask itself', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayView />, {
      tasks: [
        makeItem('Launch the site', { id: 'p' }),
        makeItem('Book the venue', { id: 'c', parent_id: 'p', due_date: YESTERDAY }),
      ],
    });

    expect(screen.getByRole('link', { name: 'Launch the site' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Book the venue' })).not.toBeInTheDocument();

    // It is still reachable the usual way — by expanding its parent.
    await user.click(screen.getByRole('button', { name: 'Expand subtasks' }));
    expect(screen.getByRole('link', { name: 'Book the venue' })).toBeInTheDocument();
  });

  it('labels each row with the folder it lives in, and the Inbox when it has none', () => {
    renderWithProviders(<TodayView />, {
      folders: [makeFolder('Work', 'work')],
      tasks: [
        makeItem('Filed task', { due_date: TODAY, folder_id: 'work' }),
        makeItem('Unfiled task', { due_date: TODAY }),
      ],
    });

    const list = screen.getByRole('list', { name: 'Tasks due today' });
    expect(within(list).getByText('Work')).toBeInTheDocument();
    expect(within(list).getByText('Inbox')).toBeInTheDocument();
  });

  it('completes a task straight from the row, dropping it out of the list', async () => {
    const user = userEvent.setup();
    mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
    renderWithProviders(<TodayView />, {
      tasks: [makeItem('Pay the invoice', { id: 'inv', due_date: TODAY })],
    });

    await user.click(screen.getByRole('button', { name: 'Mark "Pay the invoice" complete' }));

    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith('inv');
    });
    expect(screen.queryByRole('link', { name: 'Pay the invoice' })).not.toBeInTheDocument();
  });

  it('reveals what was finished today behind the Show completed toggle', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayView />, {
      tasks: [
        makeItem('Already done', {
          due_date: TODAY,
          status: 'completed',
          completed_at: '2026-09-06T08:00:00Z',
        }),
      ],
    });

    expect(screen.queryByRole('link', { name: 'Already done' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show completed/i }));

    expect(screen.getByRole('link', { name: 'Already done' })).toBeInTheDocument();
  });

  it('explains the empty list rather than showing a bare list', () => {
    renderWithProviders(<TodayView />, { tasks: [makeItem('Someday', { due_date: null })] });

    expect(screen.queryByRole('list', { name: 'Tasks due today' })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing is due today/i)).toBeInTheDocument();
  });
});
