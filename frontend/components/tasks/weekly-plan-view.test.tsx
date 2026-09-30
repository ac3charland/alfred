import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item, WeeklyPlan } from '@/lib/types';

import { WeeklyPlanView } from './weekly-plan-view';

jest.mock('@/lib/api-client');
const mockFetchWeeklyPlan = jest.mocked(apiClient.fetchWeeklyPlan);
const mockCompleteTask = jest.mocked(apiClient.completeTask);

const LATEST: WeeklyPlan = {
  id: '11111111-1111-4111-8111-111111111111',
  html: '<!DOCTYPE html><html><body><h1>Week 12</h1></body></html>',
  uploaded_at: '2026-07-24T12:00:00Z',
};
const OLDER: WeeklyPlan = {
  id: '22222222-2222-4222-8222-222222222222',
  html: '<!DOCTYPE html><html><body><h1>Week 11</h1></body></html>',
  uploaded_at: '2026-07-17T12:00:00Z',
};

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
    created_at: overrides.created_at ?? `2026-07-0${String(nextCreated)}T00:00:00Z`,
    due_date: null,
    status: overrides.status ?? 'active',
    completed_at: null,
    folder_id: overrides.folder_id ?? null,
    dispatched_at: overrides.folder_id == null ? null : DISPATCHED_AT,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: null,
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
    weekly_plan_id: overrides.weekly_plan_id ?? null,
  };
}

/** Render the view with the archive seeded (newest first, as the server orders it). */
function renderView(
  plans: WeeklyPlan[],
  { tasks = [], folders = [] }: { tasks?: Item[]; folders?: Folder[] } = {},
) {
  return renderWithProviders(<WeeklyPlanView />, {
    tasks,
    folders,
    weeklyPlans: {
      index: plans.map((plan) => ({ id: plan.id, uploaded_at: plan.uploaded_at })),
      latest: plans[0],
    },
  });
}

describe('WeeklyPlanView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the latest plan in an iframe whose srcdoc is the document verbatim', () => {
    renderView([LATEST, OLDER]);

    expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', LATEST.html);
  });

  it('sandboxes the frame with allow-scripts so the plan\'s "today" script runs', () => {
    renderView([LATEST]);

    expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('does NOT grant allow-same-origin — the frame must keep an opaque origin', () => {
    renderView([LATEST]);

    // Regression guard: `allow-scripts allow-same-origin` together would let the document
    // reach the app's cookies, storage, and parent DOM — i.e. no sandbox at all.
    const sandbox = screen.getByTestId('weekly-plan-html').getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('heads the view with the Week Plan heading', () => {
    renderView([LATEST]);

    expect(screen.getByRole('heading', { name: 'Week Plan' })).toBeInTheDocument();
  });

  it('hides the picker when there is only one plan', () => {
    renderView([LATEST]);

    expect(screen.queryByRole('combobox', { name: 'Week' })).not.toBeInTheDocument();
  });

  it('lists every plan newest-first in the picker, labelled by upload date', () => {
    renderView([LATEST, OLDER]);

    const picker = screen.getByRole('combobox', { name: 'Week' });
    expect(
      [...picker.querySelectorAll('option')].map((option) => option.textContent),
    ).toStrictEqual(['Jul 24', 'Jul 17']);
  });

  it('swaps the srcdoc to an older plan once its fetch resolves', async () => {
    mockFetchWeeklyPlan.mockResolvedValue(OLDER);
    const user = userEvent.setup();
    renderView([LATEST, OLDER]);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Week' }), OLDER.id);

    await waitFor(() => {
      expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', OLDER.html);
    });
    expect(mockFetchWeeklyPlan).toHaveBeenCalledWith(OLDER.id);
  });

  it('keeps the current plan mounted while the older one is in flight', async () => {
    let resolveFetch: ((plan: WeeklyPlan) => void) | undefined;
    mockFetchWeeklyPlan.mockReturnValue(
      new Promise<WeeklyPlan>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const user = userEvent.setup();
    renderView([LATEST, OLDER]);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Week' }), OLDER.id);

    // Still showing the latest plan — no blank frame, no spinner swap.
    expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', LATEST.html);

    resolveFetch?.(OLDER);
    await waitFor(() => {
      expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', OLDER.html);
    });
  });

  it('stays on the current plan and toasts when the fetch fails', async () => {
    mockFetchWeeklyPlan.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderView([LATEST, OLDER]);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Week' }), OLDER.id);

    expect(await screen.findByText("Couldn't load that week's plan")).toBeInTheDocument();
    expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', LATEST.html);
  });

  it('shows the upload instruction instead of a frame when nothing has been uploaded', () => {
    renderView([]);

    expect(screen.queryByTestId('weekly-plan-html')).not.toBeInTheDocument();
    expect(screen.getByText(/no week plan uploaded yet/i)).toBeInTheDocument();

    // The empty state doubles as the instructions: the exact call that fills it.
    const snippet = screen.getByTestId('weekly-plan-upload-hint').textContent;
    expect(snippet).toContain('/api/weekly-plans');
    expect(snippet).toContain('x-api-key');
    expect(snippet).toContain('--data-binary');
  });

  it('hides the picker in the empty state — there is nothing to pick', () => {
    renderView([]);

    expect(screen.queryByRole('combobox', { name: 'Week' })).not.toBeInTheDocument();
  });

  // The inline frame is cramped on a phone: it sits inside the shell's padding at a width the
  // plan's own multi-column layout was never drawn for. Tapping it hands the document the whole
  // screen. The tap target is a layer OVER the frame, because a tap inside a sandboxed iframe
  // never reaches the app — the frame swallows it.
  describe('full-screen on mobile', () => {
    const TAP_LABEL = 'View the week plan full screen';

    it('lays a tap target over the plan, labelled for what it does', () => {
      renderView([LATEST]);

      const tap = screen.getByRole('button', { name: TAP_LABEL });
      expect(tap).toHaveClass('absolute', 'inset-0');
      // Mobile-only: at md+ the inline frame is roomy and stays directly interactive. jsdom
      // never resolves the breakpoint, so the class IS the assertion here — the real viewport
      // behaviour is pinned by e2e/weekly-plan-fullscreen.spec.ts.
      expect(tap).toHaveClass('md:hidden');
    });

    it('shows a visible "Full screen" hint so the tap target is discoverable', () => {
      renderView([LATEST]);

      expect(
        within(screen.getByRole('button', { name: TAP_LABEL })).getByText('Full screen'),
      ).toBeInTheDocument();
    });

    it('offers no tap target in the empty state — there is no plan to open', () => {
      renderView([]);

      expect(screen.queryByRole('button', { name: TAP_LABEL })).not.toBeInTheDocument();
    });

    it('keeps the full-screen frame unmounted until the plan is tapped', () => {
      renderView([LATEST]);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByTestId('weekly-plan-html-fullscreen')).not.toBeInTheDocument();
    });

    it('opens the plan in a full-screen dialog when tapped', async () => {
      const user = userEvent.setup();
      renderView([LATEST]);

      await user.click(screen.getByRole('button', { name: TAP_LABEL }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByTestId('weekly-plan-html-fullscreen')).toHaveAttribute(
        'srcdoc',
        LATEST.html,
      );
    });

    it('sandboxes the full-screen frame exactly like the inline one', async () => {
      const user = userEvent.setup();
      renderView([LATEST]);

      await user.click(screen.getByRole('button', { name: TAP_LABEL }));

      // Same contract, not a laxer copy: scripts run so the plan highlights today, but the
      // frame keeps an opaque origin.
      const frame = await screen.findByTestId('weekly-plan-html-fullscreen');
      expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
      expect(frame.getAttribute('sandbox') ?? '').not.toContain('allow-same-origin');
    });

    it('titles the full-screen view with the week being shown', async () => {
      const user = userEvent.setup();
      renderView([LATEST]);

      await user.click(screen.getByRole('button', { name: TAP_LABEL }));

      // Labelled by the same upload date the picker uses, so it is unambiguous which week
      // filled the screen.
      expect(await screen.findByRole('dialog', { name: 'Week Plan · Jul 24' })).toBeInTheDocument();
    });

    it('opens whichever week is selected, not just the latest', async () => {
      mockFetchWeeklyPlan.mockResolvedValue(OLDER);
      const user = userEvent.setup();
      renderView([LATEST, OLDER]);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Week' }), OLDER.id);
      await waitFor(() => {
        expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', OLDER.html);
      });
      await user.click(screen.getByRole('button', { name: TAP_LABEL }));

      expect(await screen.findByTestId('weekly-plan-html-fullscreen')).toHaveAttribute(
        'srcdoc',
        OLDER.html,
      );
      expect(screen.getByRole('dialog', { name: 'Week Plan · Jul 17' })).toBeInTheDocument();
    });

    it('closes again on the × dismiss', async () => {
      const user = userEvent.setup();
      renderView([LATEST]);

      await user.click(screen.getByRole('button', { name: TAP_LABEL }));
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: 'Close full screen' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      // Back to the inline frame, still showing the plan.
      expect(screen.getByTestId('weekly-plan-html')).toHaveAttribute('srcdoc', LATEST.html);
    });
  });

  // The document is the plan's prose; the work it produced sits underneath it. The frame opens
  // as a short preview so the list is in view without scrolling past a whole document.
  describe('the document preview', () => {
    const EXPAND = 'Expand plan';
    const COLLAPSE = 'Collapse plan';

    it('opens as a short preview, not the full-height document', () => {
      renderView([LATEST]);

      const frame = screen.getByTestId('weekly-plan-html');
      expect(frame).toHaveClass('h-72');
      expect(frame).not.toHaveClass('md:h-[80vh]');
    });

    it('expands to full height and collapses back', async () => {
      const user = userEvent.setup();
      renderView([LATEST]);

      const toggle = screen.getByRole('button', { name: EXPAND });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);

      expect(screen.getByRole('button', { name: COLLAPSE })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      // Gated to md+ like the toggle itself: shrink the window below md while expanded and the
      // frame falls back to the preview rather than sticking at 80vh with no control to undo it.
      expect(screen.getByTestId('weekly-plan-html')).toHaveClass('h-72', 'md:h-[80vh]');

      await user.click(screen.getByRole('button', { name: COLLAPSE }));

      expect(screen.getByRole('button', { name: EXPAND })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.getByTestId('weekly-plan-html')).not.toHaveClass('md:h-[80vh]');
    });

    it('names the frame as the region the toggle controls', () => {
      renderView([LATEST]);

      const toggle = screen.getByRole('button', { name: EXPAND });
      expect(toggle.getAttribute('aria-controls')).toBe(screen.getByTestId('weekly-plan-html').id);
    });

    it('is a desktop control — a phone opens the plan full screen instead', () => {
      renderView([LATEST]);

      // jsdom never resolves the breakpoint, so the class IS the assertion (as with the tap
      // layer); e2e/weekly-plan.spec.ts pins the real desktop behaviour.
      expect(screen.getByRole('button', { name: EXPAND })).toHaveClass('hidden', 'md:inline-flex');
    });

    it('offers no toggle in the empty state — there is no document to expand', () => {
      renderView([]);

      expect(screen.queryByRole('button', { name: EXPAND })).not.toBeInTheDocument();
    });
  });

  describe("the plan's tasks", () => {
    const LIST = 'Planned tasks';

    /** The top-level row titles, in order. */
    function plannedTitles(): string[] {
      const list = screen.getByRole('list', { name: LIST });
      return within(list)
        .getAllByRole('listitem')
        .filter((li) => li.parentElement === list)
        .map((li) => within(li).getAllByRole('link')[0]?.textContent ?? '');
    }

    it('lists the items created from the shown plan, and nothing else', () => {
      renderView([LATEST, OLDER], {
        tasks: [
          makeItem('Ship the plan view', { weekly_plan_id: LATEST.id }),
          makeItem('An ordinary capture'),
          makeItem('Last week’s work', { weekly_plan_id: OLDER.id }),
        ],
      });

      expect(plannedTitles()).toStrictEqual(['Ship the plan view']);
    });

    it('reads in plan order — the order the review wrote them in', () => {
      renderView([LATEST], {
        tasks: [
          makeItem('Third', { weekly_plan_id: LATEST.id, created_at: '2026-07-24T12:00:00.000Z' }),
          makeItem('First', { weekly_plan_id: LATEST.id, created_at: '2026-07-24T12:00:00.002Z' }),
          makeItem('Second', { weekly_plan_id: LATEST.id, created_at: '2026-07-24T12:00:00.001Z' }),
        ],
      });

      expect(plannedTitles()).toStrictEqual(['First', 'Second', 'Third']);
    });

    it('keeps finished tasks in view, struck through, with the week’s progress', () => {
      renderView([LATEST], {
        tasks: [
          makeItem('Done already', { weekly_plan_id: LATEST.id, status: 'completed' }),
          makeItem('Still open', { weekly_plan_id: LATEST.id }),
        ],
      });

      expect(screen.getByRole('link', { name: 'Done already' })).toHaveClass('line-through');
      expect(screen.getByText('1 of 2 tasks done')).toBeInTheDocument();
    });

    it('lists tasks only — code, knowledge and untyped rows stay out of the list and tally', () => {
      renderView([LATEST], {
        tasks: [
          makeItem('A task', { weekly_plan_id: LATEST.id }),
          makeItem('A code story', { weekly_plan_id: LATEST.id, item_type: 'code' }),
          makeItem('A note', { weekly_plan_id: LATEST.id, item_type: 'knowledge' }),
          makeItem('Not typed yet', { weekly_plan_id: LATEST.id, item_type: 'unclassified' }),
        ],
      });

      expect(plannedTitles()).toStrictEqual(['A task']);
      expect(screen.getByText('0 of 1 task done')).toBeInTheDocument();
    });

    it('announces the tally as it moves', () => {
      renderView([LATEST], { tasks: [makeItem('A task', { weekly_plan_id: LATEST.id })] });

      expect(screen.getByText('0 of 1 task done')).toHaveAttribute('aria-live', 'polite');
    });

    it('keeps finished subtasks under their parent, struck through', async () => {
      const user = userEvent.setup();
      renderView([LATEST], {
        tasks: [
          makeItem('Launch', { id: 'root', weekly_plan_id: LATEST.id }),
          makeItem('Booked the venue', {
            parent_id: 'root',
            weekly_plan_id: LATEST.id,
            status: 'completed',
          }),
        ],
      });

      await user.click(screen.getByRole('button', { name: 'Expand subtasks' }));

      expect(screen.getByRole('link', { name: 'Booked the venue' })).toHaveClass('line-through');
    });

    it('ticks a task off in place and moves the progress', async () => {
      mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
      const user = userEvent.setup();
      renderView([LATEST], {
        tasks: [makeItem('Pay the invoice', { id: 'inv', weekly_plan_id: LATEST.id })],
      });

      expect(screen.getByText('0 of 1 task done')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Mark "Pay the invoice" complete' }));

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('inv');
      });
      // Still listed — the week plan is a record of the week, not a to-do queue.
      expect(screen.getByRole('link', { name: 'Pay the invoice' })).toHaveClass('line-through');
      expect(screen.getByText('1 of 1 task done')).toBeInTheDocument();
    });

    it('reveals a planned task’s subtasks on expand', async () => {
      const user = userEvent.setup();
      renderView([LATEST], {
        tasks: [
          makeItem('Launch', { id: 'root', weekly_plan_id: LATEST.id }),
          makeItem('Book the venue', { parent_id: 'root', weekly_plan_id: LATEST.id }),
        ],
      });

      expect(plannedTitles()).toStrictEqual(['Launch']);

      await user.click(screen.getByRole('button', { name: 'Expand subtasks' }));

      expect(screen.getByRole('link', { name: 'Book the venue' })).toBeVisible();
    });

    it('labels each row with the folder it lives in, and the Inbox when it has none', () => {
      renderView([LATEST], {
        folders: [
          { id: 'work', name: 'Work', created_at: DISPATCHED_AT, sort_order: 1, description: null },
        ],
        tasks: [
          makeItem('Filed', { weekly_plan_id: LATEST.id, folder_id: 'work' }),
          makeItem('Unfiled', { weekly_plan_id: LATEST.id }),
        ],
      });

      const list = screen.getByRole('list', { name: LIST });
      expect(within(list).getByText('Work')).toBeInTheDocument();
      expect(within(list).getByText('Inbox')).toBeInTheDocument();
    });

    it('follows the week picker to the older plan’s tasks', async () => {
      mockFetchWeeklyPlan.mockResolvedValue(OLDER);
      const user = userEvent.setup();
      renderView([LATEST, OLDER], {
        tasks: [
          makeItem('This week', { weekly_plan_id: LATEST.id }),
          makeItem('Last week', { weekly_plan_id: OLDER.id }),
        ],
      });

      await user.selectOptions(screen.getByRole('combobox', { name: 'Week' }), OLDER.id);

      await waitFor(() => {
        expect(plannedTitles()).toStrictEqual(['Last week']);
      });
    });

    it('says so when nothing was created from the plan', () => {
      renderView([LATEST], { tasks: [makeItem('An ordinary capture')] });

      expect(screen.queryByRole('list', { name: LIST })).not.toBeInTheDocument();
      expect(
        screen.getByText(/no tasks have been created from this plan yet/i),
      ).toBeInTheDocument();
    });

    it('has no task section in the empty state — there is no plan to hang it off', () => {
      renderView([], { tasks: [makeItem('Planned elsewhere', { weekly_plan_id: LATEST.id })] });

      expect(screen.queryByRole('heading', { name: LIST })).not.toBeInTheDocument();
    });

    it('heads the section so it reads apart from the document above', () => {
      renderView([LATEST]);

      expect(screen.getByRole('heading', { name: LIST })).toBeInTheDocument();
    });
  });
});
