import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { ReorderStep } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

import { BacklogRow } from './backlog-row';

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: 'ALF-1',
    factory_state: 'in_development',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: 'Wire the backlog',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Refinement',
    epic_ref: 'ALF-3',
    epic_archived_at: null,
    priority: 1,
    ...overrides,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof BacklogRow>> = {}) {
  // Distinct return values per call (rather than one fixed stub), recorded here so a test can
  // tell WHICH call's result reached commitReorder/commitMove, and in what order.
  const reorderReturns: ReorderStep[] = [];
  const applyReorder = jest.fn((ref: string, neighbourRef: string): ReorderStep => {
    const step: ReorderStep = {
      ref,
      neighbourRef,
      aItemId: `a${String(reorderReturns.length + 1)}`,
      bItemId: `b${String(reorderReturns.length + 1)}`,
      aPriorityBefore: reorderReturns.length + 1,
      bPriorityBefore: reorderReturns.length + 101,
    };
    reorderReturns.push(step);
    return step;
  });
  const commitReorder = jest.fn().mockResolvedValue(undefined);

  const moveReturns: { priorityBefore: number | null }[] = [];
  const applyMove = jest.fn((): { priorityBefore: number | null } => {
    const applied = { priorityBefore: moveReturns.length + 1 };
    moveReturns.push(applied);
    return applied;
  });
  const commitMove = jest.fn().mockResolvedValue(undefined);

  render(
    <ul>
      <BacklogRow
        story={makeStory()}
        projectColor="blue"
        prevRef="ALF-0"
        nextRef="ALF-2"
        applyReorder={applyReorder}
        commitReorder={commitReorder}
        applyMove={applyMove}
        commitMove={commitMove}
        {...props}
      />
    </ul>,
  );
  return { applyReorder, commitReorder, reorderReturns, applyMove, commitMove, moveReturns };
}

describe('BacklogRow', () => {
  it('shows the ref, title, project + epic badges, and a status chip for the factory state', () => {
    renderRow();
    expect(screen.getByText('ALF-1')).toBeInTheDocument();
    expect(screen.getByText('Wire the backlog')).toBeInTheDocument();
    expect(screen.getByText('Alfred')).toBeInTheDocument();
    expect(screen.getByText('Refinement')).toBeInTheDocument();
    expect(screen.getByText('ALF-3')).toBeInTheDocument();
    // The status chip is labelled for EVERY state — here a happy-path one.
    expect(screen.getByText('In Development')).toBeInTheDocument();
  });

  it('tints the project badge with the assigned project colour (ALF-50)', () => {
    renderRow({ projectColor: 'amber' });
    expect(screen.getByText('Alfred')).toHaveClass('bg-accent-amber/15', 'text-accent-amber');
  });

  it('links the body to the story modal in its project board', () => {
    renderRow();
    expect(screen.getByRole('link', { name: /Open ALF-1/ })).toHaveAttribute(
      'href',
      '/code/p1?story=ALF-1',
    );
  });

  it('disables Up and to-top at the top, Down and to-bottom at the bottom', () => {
    renderRow({ prevRef: null });
    expect(screen.getByRole('button', { name: 'Move ALF-1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-1 to top' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move ALF-1 down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move ALF-1 to bottom' })).toBeEnabled();
  });

  it('swaps with the previous neighbour on Up and the next on Down, INSTANTLY (no debounce delay)', async () => {
    const user = userEvent.setup();
    const { applyReorder, commitReorder } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Move ALF-1 up' }));
    expect(applyReorder).toHaveBeenCalledWith('ALF-1', 'ALF-0');

    await user.click(screen.getByRole('button', { name: 'Move ALF-1 down' }));
    expect(applyReorder).toHaveBeenCalledWith('ALF-1', 'ALF-2');

    // The network sync hasn't fired yet — only the on-screen reorder is instant.
    expect(commitReorder).not.toHaveBeenCalled();
  });

  it('jumps to the top on the double-up chevron and the bottom on the double-down, INSTANTLY', async () => {
    const user = userEvent.setup();
    const { applyMove, commitMove } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Move ALF-1 to top' }));
    expect(applyMove).toHaveBeenCalledWith('ALF-1', true);

    await user.click(screen.getByRole('button', { name: 'Move ALF-1 to bottom' }));
    expect(applyMove).toHaveBeenCalledWith('ALF-1', false);

    expect(commitMove).not.toHaveBeenCalled();
  });

  it('debounces the reorder network sync: commitReorder only fires once clicks settle', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.useFakeTimers();
    try {
      const { commitReorder } = renderRow();

      await user.click(screen.getByRole('button', { name: 'Move ALF-1 up' }));
      expect(commitReorder).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(commitReorder).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a rapid burst of Up/Down clicks reorders on screen every time, then flushes ONE commitReorder call carrying every queued step, in click order', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.useFakeTimers();
    try {
      const { applyReorder, commitReorder, reorderReturns } = renderRow();

      await user.click(screen.getByRole('button', { name: 'Move ALF-1 up' }));
      await user.click(screen.getByRole('button', { name: 'Move ALF-1 up' }));
      await user.click(screen.getByRole('button', { name: 'Move ALF-1 down' }));

      // Every click applies instantly — nothing waits for the debounce.
      expect(applyReorder).toHaveBeenCalledTimes(3);
      expect(commitReorder).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(commitReorder).toHaveBeenCalledTimes(1);
      expect(commitReorder).toHaveBeenCalledWith(reorderReturns);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a rapid burst of top/bottom clicks flushes ONE commitMove call with the LATEST direction but the FIRST click's prior priority", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.useFakeTimers();
    try {
      const { applyMove, commitMove, moveReturns } = renderRow();

      await user.click(screen.getByRole('button', { name: 'Move ALF-1 to top' }));
      await user.click(screen.getByRole('button', { name: 'Move ALF-1 to bottom' }));

      expect(applyMove).toHaveBeenCalledTimes(2);
      expect(commitMove).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(commitMove).toHaveBeenCalledTimes(1);
      const [firstApplied] = moveReturns;
      if (firstApplied === undefined) throw new Error('expected a move to have been applied');
      // Latest direction (bottom = false), but the burst's ORIGINAL prior priority, not the
      // second click's — a failed commit must roll back to before the whole burst.
      expect(commitMove).toHaveBeenCalledWith('ALF-1', false, firstApplied.priorityBefore);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── Mobile card layout (ALF-86): full-width wrapping title + badge footer + big tap targets ──

  it('wraps the full title on mobile (text-base, no truncate) but truncates at md+', () => {
    renderRow();
    const title = screen.getByText('Wire the backlog');
    // Mobile: the title reads at text-base and wraps instead of truncating to "Wire…".
    expect(title).toHaveClass('text-base', 'break-words');
    expect(title).not.toHaveClass('truncate');
    // md+ restores today's single-line truncation.
    expect(title).toHaveClass('md:truncate', 'md:text-sm');
  });

  it('drops the badges into a full-width footer on mobile, inline at md+', () => {
    renderRow();
    // The project / epic / status badges share one wrapper that wraps below the title on mobile
    // (basis-full) and dissolves to inline at md+ (display:contents).
    const footer = screen.getByText('Alfred').parentElement;
    expect(footer).toHaveClass('basis-full', 'md:contents');
  });

  it('gives every reorder chevron a ≥44px tap target on mobile, back to 20px at md+', () => {
    renderRow();
    for (const name of [
      'Move ALF-1 up',
      'Move ALF-1 down',
      'Move ALF-1 to top',
      'Move ALF-1 to bottom',
    ]) {
      // h-11/w-11 = 44px on mobile; md:h-5/md:w-5 = 20px on desktop.
      expect(screen.getByRole('button', { name })).toHaveClass('h-11', 'w-11', 'md:h-5', 'md:w-5');
    }
  });
});
