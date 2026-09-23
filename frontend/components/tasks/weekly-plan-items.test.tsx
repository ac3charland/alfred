import { render, screen, within } from '@testing-library/react';

import * as apiClient from '@/lib/api-client';
import type { WeeklyPlanItemCounts, WeeklyPlanItemNode } from '@/lib/weekly-plan-items/payload';

import { WeeklyPlanItems } from './weekly-plan-items';

jest.mock('@/lib/api-client');
const mockFetchWeeklyPlanItems = jest.mocked(apiClient.fetchWeeklyPlanItems);

const PLAN = { id: 'plan-1', uploaded_at: '2026-09-05T21:03:11.482Z' };

/** A node with every field the row doesn't care about already at a sane default. */
function node(
  overrides: Partial<WeeklyPlanItemNode> & Pick<WeeklyPlanItemNode, 'id' | 'title'>,
): WeeklyPlanItemNode {
  return {
    item_type: 'task',
    notes: null,
    due_date: null,
    priority: null,
    state: 'active',
    done: false,
    done_at: null,
    created_at: '2026-09-05T21:04:02.118Z',
    folder: null,
    in_inbox: true,
    code: null,
    children: [],
    ...overrides,
  };
}

const EMPTY_COUNTS: WeeklyPlanItemCounts = {
  total: 0,
  done: 0,
  open: 0,
  abandoned: 0,
  untriaged: 0,
};

/** A never-settling fetch, so the loading state can be asserted before data lands. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe('WeeklyPlanItems', () => {
  it('reserves the section with a skeleton while the cohort is in flight', () => {
    mockFetchWeeklyPlanItems.mockReturnValue(pending());

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(screen.getByRole('heading', { name: 'From this plan' })).toBeInTheDocument();
    expect(screen.getByTestId('weekly-plan-items-loading')).toBeInTheDocument();
  });

  it('shows a muted note and no list when the read fails', async () => {
    mockFetchWeeklyPlanItems.mockRejectedValue(new Error('offline'));

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(await screen.findByText("Couldn't load this week's tasks.")).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /tasks and code stories/i })).not.toBeInTheDocument();
  });

  it('says nothing was created yet when the plan has an empty cohort', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({ plan: PLAN, counts: EMPTY_COUNTS, items: [] });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(
      await screen.findByText('Nothing has been created from this plan yet.'),
    ).toBeInTheDocument();
  });

  it('summarises the cohort as done-of-total, folding in the abandoned count', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 4, done: 1, open: 2, abandoned: 1, untriaged: 3 },
      items: [node({ id: 'a', title: 'Ship the spike' })],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(await screen.findByText('1 of 4 done · 1 abandoned')).toBeInTheDocument();
  });

  it('omits the abandoned clause when nothing was abandoned', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 2, done: 1, open: 1, abandoned: 0, untriaged: 2 },
      items: [node({ id: 'a', title: 'Ship the spike' })],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(await screen.findByText('1 of 2 done')).toBeInTheDocument();
  });

  it('marks a done task row with a strikethrough title and a "Done" indicator', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 1, done: 1, open: 0, abandoned: 0, untriaged: 0 },
      items: [node({ id: 'a', title: 'Ship the spike', done: true, state: 'completed' })],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    const title = await screen.findByText('Ship the spike');
    expect(title).toHaveClass('line-through');
    expect(screen.getByLabelText('Done')).toBeInTheDocument();
    expect(screen.queryByLabelText('Open')).not.toBeInTheDocument();
  });

  it('marks an open row with no strikethrough and an "Open" indicator', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 1, done: 0, open: 1, abandoned: 0, untriaged: 1 },
      items: [node({ id: 'a', title: 'Ship the spike' })],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    const title = await screen.findByText('Ship the spike');
    expect(title).not.toHaveClass('line-through');
    expect(screen.getByLabelText('Open')).toBeInTheDocument();
  });

  it('nests a subtask under its root, indented one level deeper', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 2, done: 0, open: 2, abandoned: 0, untriaged: 2 },
      items: [
        node({
          id: 'root',
          title: 'Ship the spike',
          children: [node({ id: 'child', title: 'Write the harness skeleton' })],
        }),
      ],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    const list = await screen.findByRole('list', { name: /tasks and code stories/i });
    const items = within(list).getAllByRole('listitem');
    // The root's own <li> nests a second <ul> for its children, so both roots and children are
    // "listitem" — the child is the one carrying the subtask's title.
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Write the harness skeleton')]),
    );
  });

  it('shows a code story’s ref and its factory-state chip', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 1, done: 0, open: 1, abandoned: 0, untriaged: 0 },
      items: [
        node({
          id: 'a',
          title: 'Per-voice mute in the mixer',
          item_type: 'code',
          state: 'ready_for_review',
          code: { ref: 'RPL-142', lane: 'human' },
        }),
      ],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(await screen.findByText('RPL-142')).toBeInTheDocument();
    expect(screen.getByText('Ready for Review')).toBeInTheDocument();
  });

  it('labels a planned code story that never entered the factory as "Not started"', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 1, done: 0, open: 1, abandoned: 0, untriaged: 1 },
      items: [
        node({
          id: 'a',
          title: 'Per-voice mute in the mixer',
          item_type: 'code',
          state: 'active',
          code: null,
        }),
      ],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    expect(await screen.findByText('Not started')).toBeInTheDocument();
  });

  it('shows the due date and priority when the row carries them', async () => {
    mockFetchWeeklyPlanItems.mockResolvedValue({
      plan: PLAN,
      counts: { total: 1, done: 0, open: 1, abandoned: 0, untriaged: 1 },
      items: [
        node({
          id: 'a',
          title: 'Ship the spike',
          due_date: '2026-09-08',
          priority: 'high',
        }),
      ],
    });

    render(<WeeklyPlanItems planId={PLAN.id} />);

    await screen.findByText('Ship the spike');
    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/priority: high/i)).toBeInTheDocument();
  });

  it('re-fetches the cohort when the plan id changes', async () => {
    mockFetchWeeklyPlanItems.mockImplementation((id) =>
      Promise.resolve({
        plan: { id, uploaded_at: PLAN.uploaded_at },
        counts: { total: 1, done: 0, open: 1, abandoned: 0, untriaged: 1 },
        items: [node({ id: `${id}-item`, title: `Task for ${id}` })],
      }),
    );

    const { rerender } = render(<WeeklyPlanItems planId="plan-a" />);
    expect(await screen.findByText('Task for plan-a')).toBeInTheDocument();

    rerender(<WeeklyPlanItems planId="plan-b" />);

    expect(await screen.findByText('Task for plan-b')).toBeInTheDocument();
    expect(mockFetchWeeklyPlanItems).toHaveBeenCalledWith('plan-a');
    expect(mockFetchWeeklyPlanItems).toHaveBeenCalledWith('plan-b');
  });
});
