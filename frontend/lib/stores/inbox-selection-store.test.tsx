import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import {
  InboxSelectionProvider,
  useInboxSelection,
  useInboxSelectionActions,
} from './inbox-selection-store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <InboxSelectionProvider>{children}</InboxSelectionProvider>;
}

function useSelectionTest() {
  return { state: useInboxSelection(), actions: useInboxSelectionActions() };
}

describe('InboxSelectionProvider', () => {
  it('starts idle with an empty selection', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });
    expect(result.current.state.active).toBe(false);
    expect(result.current.state.selectedIds.size).toBe(0);
  });

  it('enter turns select mode on (Idle → Selecting·0)', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
    });

    expect(result.current.state.active).toBe(true);
    expect(result.current.state.selectedIds.size).toBe(0);
  });

  it('toggle adds an id, toggling again removes it', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
      result.current.actions.toggle('a');
    });
    expect(result.current.state.selectedIds.has('a')).toBe(true);

    act(() => {
      result.current.actions.toggle('a');
    });
    expect(result.current.state.selectedIds.has('a')).toBe(false);
  });

  it('toggle tracks several ids independently', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
      result.current.actions.toggle('a');
      result.current.actions.toggle('b');
    });

    expect(result.current.state.selectedIds.has('a')).toBe(true);
    expect(result.current.state.selectedIds.has('b')).toBe(true);
    expect(result.current.state.selectedIds.size).toBe(2);
  });

  it('clear empties the selection but stays in select mode', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
      result.current.actions.toggle('a');
      result.current.actions.toggle('b');
    });

    act(() => {
      result.current.actions.clear();
    });

    expect(result.current.state.active).toBe(true);
    expect(result.current.state.selectedIds.size).toBe(0);
  });

  it('exit turns select mode off and clears the selection', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
      result.current.actions.toggle('a');
    });

    act(() => {
      result.current.actions.exit();
    });

    expect(result.current.state.active).toBe(false);
    expect(result.current.state.selectedIds.size).toBe(0);
  });

  it('prune keeps only the still-valid ids (an item that left the Inbox drops out)', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
      result.current.actions.toggle('a');
      result.current.actions.toggle('b');
      result.current.actions.toggle('c');
    });

    act(() => {
      result.current.actions.prune(['a', 'c']);
    });

    expect(result.current.state.selectedIds.has('a')).toBe(true);
    expect(result.current.state.selectedIds.has('b')).toBe(false);
    expect(result.current.state.selectedIds.has('c')).toBe(true);
  });

  it('prune with nothing to drop leaves the set reference unchanged (no needless render)', () => {
    const { result } = renderHook(useSelectionTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.enter();
      result.current.actions.toggle('a');
    });
    const before = result.current.state.selectedIds;

    act(() => {
      result.current.actions.prune(['a', 'b']);
    });

    expect(result.current.state.selectedIds).toBe(before);
  });
});

describe('hooks outside a provider', () => {
  it('useInboxSelection throws when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useInboxSelection)).toThrow(
      /must be used within an InboxSelectionProvider/,
    );
    spy.mockRestore();
  });

  it('useInboxSelectionActions throws when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useInboxSelectionActions)).toThrow(
      /must be used within an InboxSelectionProvider/,
    );
    spy.mockRestore();
  });
});
