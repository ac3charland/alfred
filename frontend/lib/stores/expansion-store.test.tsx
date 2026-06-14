import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import { ExpansionProvider, useExpansion, useExpansionActions } from './expansion-store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ExpansionProvider>{children}</ExpansionProvider>;
}

function useExpansionTest() {
  return { state: useExpansion(), actions: useExpansionActions() };
}

describe('ExpansionProvider', () => {
  it('starts with nothing expanded', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });
    expect(result.current.state.subtasks.size).toBe(0);
    expect(result.current.state.completed.size).toBe(0);
  });

  it('toggleSubtasks opens a row, toggling again closes it', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.toggleSubtasks('a');
    });
    expect(result.current.state.subtasks.has('a')).toBe(true);

    act(() => {
      result.current.actions.toggleSubtasks('a');
    });
    expect(result.current.state.subtasks.has('a')).toBe(false);
  });

  it('expandSubtasks opens a row', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.expandSubtasks('a');
    });

    expect(result.current.state.subtasks.has('a')).toBe(true);
  });

  it('expandSubtasks on an already-open row is a no-op (same set reference)', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.expandSubtasks('a');
    });
    const openedSet = result.current.state.subtasks;

    act(() => {
      result.current.actions.expandSubtasks('a');
    });

    // Idempotent: the row stays open and the set identity is unchanged (no needless render).
    expect(result.current.state.subtasks.has('a')).toBe(true);
    expect(result.current.state.subtasks).toBe(openedSet);
  });

  it('toggleCompleted opens and closes a row’s completed panel independently of subtasks', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.toggleCompleted('a');
    });
    expect(result.current.state.completed.has('a')).toBe(true);
    // Completed panel and subtask tree are separate flags.
    expect(result.current.state.subtasks.has('a')).toBe(false);

    act(() => {
      result.current.actions.toggleCompleted('a');
    });
    expect(result.current.state.completed.has('a')).toBe(false);
  });

  it('collapseAll clears the passed ids from BOTH the subtask and completed sets', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.expandSubtasks('a');
      result.current.actions.toggleCompleted('a');
    });
    expect(result.current.state.subtasks.has('a')).toBe(true);
    expect(result.current.state.completed.has('a')).toBe(true);

    act(() => {
      result.current.actions.collapseAll(['a']);
    });

    expect(result.current.state.subtasks.has('a')).toBe(false);
    expect(result.current.state.completed.has('a')).toBe(false);
  });

  it('collapseAll leaves ids outside the passed set untouched (per-view scope)', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.expandSubtasks('a'); // belongs to view A
      result.current.actions.expandSubtasks('b'); // belongs to view B
    });

    // Collapsing view A's ids must not touch view B's expanded row.
    act(() => {
      result.current.actions.collapseAll(['a']);
    });

    expect(result.current.state.subtasks.has('a')).toBe(false);
    expect(result.current.state.subtasks.has('b')).toBe(true);
  });

  it('collapseAll with no matching ids leaves the sets unchanged (same reference)', () => {
    const { result } = renderHook(useExpansionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.expandSubtasks('a');
    });
    const before = result.current.state.subtasks;

    act(() => {
      result.current.actions.collapseAll(['x']);
    });

    expect(result.current.state.subtasks).toBe(before);
  });
});

describe('hooks outside a provider', () => {
  it('useExpansion throws when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useExpansion)).toThrow(/must be used within an ExpansionProvider/);
    spy.mockRestore();
  });

  it('useExpansionActions throws when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useExpansionActions)).toThrow(
      /must be used within an ExpansionProvider/,
    );
    spy.mockRestore();
  });
});
