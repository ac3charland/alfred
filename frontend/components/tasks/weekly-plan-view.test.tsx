import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { WeeklyPlan } from '@/lib/types';

import { WeeklyPlanView } from './weekly-plan-view';

jest.mock('@/lib/api-client');
const mockFetchWeeklyPlan = jest.mocked(apiClient.fetchWeeklyPlan);

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

/** Render the view with the archive seeded (newest first, as the server orders it). */
function renderView(plans: WeeklyPlan[]) {
  return renderWithProviders(<WeeklyPlanView />, {
    weeklyPlans: {
      index: plans.map((plan) => ({ id: plan.id, uploaded_at: plan.uploaded_at })),
      latest: plans[0],
    },
  });
}

describe('WeeklyPlanView', () => {
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
});
