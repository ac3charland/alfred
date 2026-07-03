import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { useStatusFilter } from '@/lib/hooks/use-status-filter';
import type { CodeFactoryState } from '@/lib/types';

import { CodeFilterProvider, useCodeFilterActions, useCodeFilters } from './code-filter-store';

const DEFAULT: readonly CodeFactoryState[] = ['needs_refinement', 'in_development'];

describe('CodeFilterProvider', () => {
  it('throws when read outside a provider', () => {
    expect(() => renderHook(() => useCodeFilters())).toThrow(
      /must be used within a CodeFilterProvider/,
    );
  });

  it('starts empty so every view falls through to its own default', () => {
    const { result } = renderHook(() => useCodeFilters(), {
      wrapper: CodeFilterProvider,
    });

    expect(result.current.byKey.size).toBe(0);
  });

  it('seeds a first functional update from the passed default, not an empty list', () => {
    const { result } = renderHook(
      () => ({ state: useCodeFilters(), actions: useCodeFilterActions() }),
      { wrapper: CodeFilterProvider },
    );

    // First touch of the key: the updater must see the default as its base.
    act(() => {
      result.current.actions.setStatuses('backlog', DEFAULT, (current) => [...current, 'done']);
    });

    expect(result.current.state.byKey.get('backlog')).toEqual([...DEFAULT, 'done']);
  });
});

/**
 * The ticket's core behaviour (ALF-79): a Code view's status filter survives SPA navigation.
 * We reproduce that at the unit level by toggling which keyed consumer is mounted under ONE
 * persistent provider — the same lifecycle the shell layout gives the Backlog/board views as
 * `CodeView` swaps them by URL. A selection made in a view must still be there when that view
 * remounts.
 */
describe('status filter persistence across a view remount', () => {
  function Consumer({ viewKey }: { viewKey: string }) {
    const { statuses, toggle } = useStatusFilter(viewKey, DEFAULT);
    return (
      <div>
        <span data-testid="statuses">{statuses.join(',')}</span>
        <button
          type="button"
          onClick={() => {
            toggle('done');
          }}
        >
          toggle done
        </button>
      </div>
    );
  }

  // A tiny "router": show one keyed view at a time, switchable by button — the provider stays
  // mounted while the inner view unmounts and remounts, exactly like the real SPA switch.
  function Harness() {
    const [view, setView] = React.useState<'backlog' | 'board'>('backlog');
    return (
      <CodeFilterProvider>
        <button
          type="button"
          onClick={() => {
            setView((v) => (v === 'backlog' ? 'board' : 'backlog'));
          }}
        >
          switch view
        </button>
        <Consumer viewKey={view === 'backlog' ? 'backlog' : 'project-1'} />
      </CodeFilterProvider>
    );
  }

  it('restores a view its own selection after navigating away and back', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId('statuses')).toHaveTextContent('needs_refinement,in_development');

    // Filter the Backlog (add `done`).
    await user.click(screen.getByRole('button', { name: 'toggle done' }));
    expect(screen.getByTestId('statuses')).toHaveTextContent(
      'needs_refinement,in_development,done',
    );

    // Navigate to the board: a different key, so it shows its own untouched default.
    await user.click(screen.getByRole('button', { name: 'switch view' }));
    expect(screen.getByTestId('statuses')).toHaveTextContent('needs_refinement,in_development');

    // Navigate back to the Backlog: its earlier selection is restored, not reset.
    await user.click(screen.getByRole('button', { name: 'switch view' }));
    expect(screen.getByTestId('statuses')).toHaveTextContent(
      'needs_refinement,in_development,done',
    );
  });
});
