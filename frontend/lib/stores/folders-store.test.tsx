import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { Folder } from '@/lib/types';

import { FoldersProvider, foldersReducer, useFolderActions, useFolders } from './folders-store';

jest.mock('@/lib/api-client');
const mockCreateFolder = jest.mocked(apiClient.createFolder);
const mockUpdateFolder = jest.mocked(apiClient.updateFolder);
const mockDeleteFolder = jest.mocked(apiClient.deleteFolder);

// Capture showToast so the error-toast tests can assert the message a failed write surfaces
// (ALF-33). Mocking useToastActions short-circuits the context, so the provider needs no
// ToastProvider wrapper — consistent with code-store.test.tsx.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

const WORK: Folder = { id: 'f-1', name: 'Work', created_at: '2025-01-01T00:00:00Z' };
const HOME: Folder = { id: 'f-2', name: 'Home', created_at: '2025-01-02T00:00:00Z' };
const PLAY: Folder = { id: 'f-3', name: 'Play', created_at: '2025-01-03T00:00:00Z' };

function makeWrapper(initialFolders: Folder[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <FoldersProvider initialFolders={initialFolders}>{children}</FoldersProvider>;
  };
}

function useFoldersTest() {
  return { folders: useFolders(), actions: useFolderActions() };
}

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

describe('foldersReducer', () => {
  it('insert appends a folder', () => {
    expect(foldersReducer([WORK], { type: 'insert', folder: HOME })).toStrictEqual([WORK, HOME]);
  });

  it('insertAt inserts at the given index, preserving items after it', () => {
    // Insert at position 0 — items after the inserted position remain after it
    expect(foldersReducer([HOME], { type: 'insertAt', folder: WORK, index: 0 })).toStrictEqual([
      WORK,
      HOME,
    ]);
    // Insert in the middle — items before and after are preserved in order
    expect(
      foldersReducer([WORK, PLAY], { type: 'insertAt', folder: HOME, index: 1 }),
    ).toStrictEqual([WORK, HOME, PLAY]);
    // Insert at the end
    expect(
      foldersReducer([WORK, HOME], { type: 'insertAt', folder: PLAY, index: 2 }),
    ).toStrictEqual([WORK, HOME, PLAY]);
  });

  it('insertAt clamps negative indices to 0', () => {
    expect(
      foldersReducer([WORK, HOME], { type: 'insertAt', folder: PLAY, index: -1 }),
    ).toStrictEqual([PLAY, WORK, HOME]);
  });

  it('insertAt clamps out-of-bounds indices to state.length', () => {
    expect(
      foldersReducer([WORK, HOME], { type: 'insertAt', folder: PLAY, index: 99 }),
    ).toStrictEqual([WORK, HOME, PLAY]);
  });

  it('replace swaps the matching folder, and is a no-op for an absent id', () => {
    const renamed = { ...WORK, name: 'Job' };
    expect(foldersReducer([WORK], { type: 'replace', id: 'f-1', folder: renamed })).toStrictEqual([
      renamed,
    ]);
    expect(foldersReducer([WORK], { type: 'replace', id: 'gone', folder: renamed })).toStrictEqual([
      WORK,
    ]);
  });

  it('patch updates fields by id (race rule: no-op when absent)', () => {
    expect(
      foldersReducer([WORK], { type: 'patch', id: 'f-1', patch: { name: 'Job' } }),
    ).toStrictEqual([{ ...WORK, name: 'Job' }]);
    expect(
      foldersReducer([WORK], { type: 'patch', id: 'gone', patch: { name: 'Job' } }),
    ).toStrictEqual([WORK]);
  });

  it('remove drops the matching folder', () => {
    expect(foldersReducer([WORK, HOME], { type: 'remove', id: 'f-1' })).toStrictEqual([HOME]);
  });

  it('unknown action type throws via assertNever', () => {
    expect(() =>
      foldersReducer([WORK], { type: 'unknown' } as unknown as Parameters<
        typeof foldersReducer
      >[1]),
    ).toThrow('Unhandled folder action');
  });
});

// ---------------------------------------------------------------------------
// addFolder
// ---------------------------------------------------------------------------

describe('addFolder', () => {
  it('inserts a temp folder optimistically before the request resolves', () => {
    mockCreateFolder.mockReturnValue(new Promise<Folder>(() => {}));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([]) });

    act(() => {
      void result.current.actions.addFolder('Projects');
    });

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.name).toBe('Projects');
    expect(result.current.folders[0]?.id.startsWith('temp-')).toBe(true);
  });

  it('reconciles the temp folder to the saved server row (replaces temp id and fields)', async () => {
    const saved: Folder = { id: 'server-1', name: 'Projects', created_at: '2025-02-01T00:00:00Z' };
    mockCreateFolder.mockResolvedValue(saved);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addFolder('Projects');
    });

    expect(result.current.folders).toStrictEqual([saved]);
    // Verify the server id replaced the temp id (no temp- id remains)
    expect(result.current.folders[0]?.id).toBe('server-1');
  });

  it('rolls back the optimistic folder when the request fails', async () => {
    mockCreateFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addFolder('Projects').catch(() => {});
    });

    expect(result.current.folders).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renameFolder
// ---------------------------------------------------------------------------

describe('renameFolder', () => {
  it('applies the new name optimistically (before the request resolves)', () => {
    mockUpdateFolder.mockReturnValue(new Promise<Folder>(() => {}));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    act(() => {
      void result.current.actions.renameFolder('f-1', 'Job');
    });

    // The optimistic patch must set the name — not leave it blank
    expect(result.current.folders[0]?.name).toBe('Job');
  });

  it('renames optimistically and reconciles with the server row', async () => {
    const saved: Folder = { ...WORK, name: 'Job' };
    mockUpdateFolder.mockResolvedValue(saved);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Job');
    });

    expect(result.current.folders[0]?.name).toBe('Job');
  });

  it('renames the correct folder when multiple folders exist', async () => {
    // The find predicate must use folder.id === id (not find((folder) => true))
    const savedHome: Folder = { ...HOME, name: 'MyHome' };
    mockUpdateFolder.mockResolvedValue(savedHome);
    const { result } = renderHook(useFoldersTest, {
      wrapper: makeWrapper([WORK, HOME]),
    });

    await act(async () => {
      await result.current.actions.renameFolder('f-2', 'MyHome');
    });

    // WORK must be unchanged; HOME must have new name
    expect(result.current.folders[0]?.name).toBe('Work');
    expect(result.current.folders[1]?.name).toBe('MyHome');
  });

  it('rolls back to the correct folder name (not the first folder) when rename of second folder fails', async () => {
    // If find predicate is wrong (returns first folder regardless), the rollback would
    // patch 'f-2' with WORK's name ('Work') instead of HOME's original name ('Home').
    mockUpdateFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, {
      wrapper: makeWrapper([WORK, HOME]),
    });

    await act(async () => {
      await result.current.actions.renameFolder('f-2', 'NewName').catch(() => {});
    });

    // HOME must be restored to 'Home', not to WORK's name 'Work'
    expect(result.current.folders[0]?.name).toBe('Work');
    expect(result.current.folders[1]?.name).toBe('Home');
  });

  it('restores the previous name when the request fails', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Job').catch(() => {});
    });

    expect(result.current.folders[0]?.name).toBe('Work');
  });

  it('does not add phantom folders when renaming a non-existent id and the request fails', async () => {
    // if (previous) guard must be respected — without it, rollback dispatches for a
    // folder that never existed and can produce a phantom entry.
    mockUpdateFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.renameFolder('does-not-exist', 'Job').catch(() => {});
    });

    // Store must not have grown — no phantom folder
    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.id).toBe('f-1');
  });

  it('re-throws the original API error even when the rename id does not exist', async () => {
    // if (previous) guard: when `if (true)` is substituted, the code tries to access
    // `undefined.name` and throws a TypeError instead of the original error. This test
    // verifies the original error identity is preserved.
    const networkError = new Error('network');
    mockUpdateFolder.mockRejectedValue(networkError);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });
    let caughtError: unknown;

    await act(async () => {
      try {
        await result.current.actions.renameFolder('does-not-exist', 'Job');
      } catch (error) {
        caughtError = error;
      }
    });

    expect(caughtError).toBe(networkError);
  });

  it('captures the pre-rename state from the ref so a subsequent rename rolls back correctly', async () => {
    // This exercises the foldersRef sync — if the ref is stale, the second rename
    // would roll back to the wrong name.
    const savedJob: Folder = { ...WORK, name: 'Job' };
    mockUpdateFolder.mockResolvedValueOnce(savedJob).mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    // First rename succeeds: Work → Job
    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Job');
    });
    expect(result.current.folders[0]?.name).toBe('Job');

    // Second rename fails: should roll back to 'Job' (the current name), not 'Work'
    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Hobby').catch(() => {});
    });
    expect(result.current.folders[0]?.name).toBe('Job');
  });
});

// ---------------------------------------------------------------------------
// removeFolder
// ---------------------------------------------------------------------------

describe('removeFolder', () => {
  it('removes optimistically', () => {
    mockDeleteFolder.mockReturnValue(new Promise<{ success: true }>(() => {}));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK, HOME]) });

    act(() => {
      void result.current.actions.removeFolder('f-1');
    });

    expect(result.current.folders.map((f) => f.id)).toStrictEqual(['f-2']);
  });

  it('restores the folder at its original position when the request fails', async () => {
    mockDeleteFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK, HOME]) });

    await act(async () => {
      await result.current.actions.removeFolder('f-1').catch(() => {});
    });

    expect(result.current.folders.map((f) => f.id)).toStrictEqual(['f-1', 'f-2']);
  });

  it('restores the second folder at index 1 (not index 0) when removal fails', async () => {
    // findIndex must use folder.id === id; using (folder) => true would always
    // capture index 0 and restore at index 0 instead of index 1.
    mockDeleteFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, {
      wrapper: makeWrapper([WORK, HOME, PLAY]),
    });

    await act(async () => {
      await result.current.actions.removeFolder('f-2').catch(() => {});
    });

    // HOME (f-2) must be restored at index 1, between WORK and PLAY
    expect(result.current.folders.map((f) => f.id)).toStrictEqual(['f-1', 'f-2', 'f-3']);
  });

  it('does not add phantom folders when removing a non-existent id and the request fails', async () => {
    // if (previous) guard must prevent insertAt when the id was never in the list
    mockDeleteFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.removeFolder('does-not-exist').catch(() => {});
    });

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.id).toBe('f-1');
  });
});

// ---------------------------------------------------------------------------
// Error toasts (ALF-33)
// ---------------------------------------------------------------------------

describe('error toasts', () => {
  it('addFolder toasts "Couldn\'t create folder" and re-throws on failure', async () => {
    const networkError = new Error('network');
    mockCreateFolder.mockRejectedValue(networkError);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([]) });
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.actions.addFolder('Projects');
      } catch (error) {
        caught = error;
      }
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't create folder");
    expect(result.current.folders).toStrictEqual([]);
    expect(caught).toBe(networkError);
  });

  it('renameFolder toasts "Couldn\'t rename folder" on failure', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Job').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't rename folder");
    expect(result.current.folders[0]?.name).toBe('Work');
  });

  it('removeFolder toasts "Couldn\'t delete folder" on failure', async () => {
    mockDeleteFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK, HOME]) });

    await act(async () => {
      await result.current.actions.removeFolder('f-1').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't delete folder");
    expect(result.current.folders.map((f) => f.id)).toStrictEqual(['f-1', 'f-2']);
  });
});

// ---------------------------------------------------------------------------
// Context wiring
// ---------------------------------------------------------------------------

describe('context wiring', () => {
  it('keeps action identity stable across state changes (split contexts)', async () => {
    mockCreateFolder.mockResolvedValue(WORK);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([]) });
    const before = result.current.actions;

    await act(async () => {
      await result.current.actions.addFolder('Work');
    });

    expect(result.current.actions).toBe(before);
  });

  it('throws when useFolders is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useFolders)).toThrow(/must be used within a FoldersProvider/);
    spy.mockRestore();
  });

  it('throws when useFolderActions is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useFolderActions)).toThrow(/must be used within a FoldersProvider/);
    spy.mockRestore();
  });
});
