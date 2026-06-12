import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import {
  type ActiveEditor,
  ActiveEditorProvider,
  sameEditor,
  useActiveEditor,
  useActiveEditorActions,
} from './active-editor-store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ActiveEditorProvider>{children}</ActiveEditorProvider>;
}

function useActiveEditorTest() {
  return { active: useActiveEditor(), actions: useActiveEditorActions() };
}

const TITLE_A: ActiveEditor = { itemId: 'a', kind: 'title' };
const SUBTASK_A: ActiveEditor = { itemId: 'a', kind: 'subtask' };
const TITLE_B: ActiveEditor = { itemId: 'b', kind: 'title' };

// ---------------------------------------------------------------------------
// sameEditor (pure)
// ---------------------------------------------------------------------------

describe('sameEditor', () => {
  it('is true for the same item id and kind', () => {
    expect(sameEditor({ itemId: 'a', kind: 'title' }, TITLE_A)).toBe(true);
  });

  it('is false when the item id differs', () => {
    expect(sameEditor(TITLE_B, TITLE_A)).toBe(false);
  });

  it('is false when the kind differs', () => {
    expect(sameEditor(SUBTASK_A, TITLE_A)).toBe(false);
  });

  it('is false when the current editor is null', () => {
    expect(sameEditor(null, TITLE_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider behavior
// ---------------------------------------------------------------------------

describe('ActiveEditorProvider', () => {
  it('starts with no editor open', () => {
    const { result } = renderHook(useActiveEditorTest, { wrapper: Wrapper });
    expect(result.current.active).toBeNull();
  });

  it('openEditor makes that editor the active one', () => {
    const { result } = renderHook(useActiveEditorTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.openEditor(TITLE_A);
    });

    expect(result.current.active).toStrictEqual(TITLE_A);
  });

  it('opening a second editor replaces the first (only one open at a time)', () => {
    const { result } = renderHook(useActiveEditorTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.openEditor(SUBTASK_A);
    });
    act(() => {
      result.current.actions.openEditor(TITLE_B);
    });

    expect(result.current.active).toStrictEqual(TITLE_B);
  });

  it('closeEditor clears the active editor when it matches', () => {
    const { result } = renderHook(useActiveEditorTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.openEditor(TITLE_A);
    });
    act(() => {
      result.current.actions.closeEditor(TITLE_A);
    });

    expect(result.current.active).toBeNull();
  });

  it('closeEditor is a no-op when a different editor is now open', () => {
    // A stale close (e.g. an async title save resolving after another input opened)
    // must not close the input that took over.
    const { result } = renderHook(useActiveEditorTest, { wrapper: Wrapper });

    act(() => {
      result.current.actions.openEditor(TITLE_B);
    });
    act(() => {
      result.current.actions.closeEditor(TITLE_A);
    });

    expect(result.current.active).toStrictEqual(TITLE_B);
  });
});

// ---------------------------------------------------------------------------
// Hooks require a provider
// ---------------------------------------------------------------------------

describe('hooks outside a provider', () => {
  it('useActiveEditor throws when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useActiveEditor)).toThrow(
      /must be used within an ActiveEditorProvider/,
    );
    spy.mockRestore();
  });

  it('useActiveEditorActions throws when used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useActiveEditorActions)).toThrow(
      /must be used within an ActiveEditorProvider/,
    );
    spy.mockRestore();
  });
});
