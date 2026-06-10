import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { Folder } from '@/lib/types';

import { FoldersProvider, foldersReducer, useFolderActions, useFolders } from './folders-store';

jest.mock('@/lib/api-client');
const mockCreateFolder = jest.mocked(apiClient.createFolder);
const mockUpdateFolder = jest.mocked(apiClient.updateFolder);
const mockDeleteFolder = jest.mocked(apiClient.deleteFolder);

const WORK: Folder = { id: 'f-1', name: 'Work', created_at: '2025-01-01T00:00:00Z' };
const HOME: Folder = { id: 'f-2', name: 'Home', created_at: '2025-01-02T00:00:00Z' };

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

  it('insertAt restores a folder at a position', () => {
    expect(foldersReducer([HOME], { type: 'insertAt', folder: WORK, index: 0 })).toStrictEqual([
      WORK,
      HOME,
    ]);
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

  it('reconciles the temp folder to the saved server row', async () => {
    const saved: Folder = { id: 'server-1', name: 'Projects', created_at: '2025-02-01T00:00:00Z' };
    mockCreateFolder.mockResolvedValue(saved);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addFolder('Projects');
    });

    expect(result.current.folders).toStrictEqual([saved]);
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
  it('renames optimistically and reconciles with the server row', async () => {
    const saved: Folder = { ...WORK, name: 'Job' };
    mockUpdateFolder.mockResolvedValue(saved);
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Job');
    });

    expect(result.current.folders[0]?.name).toBe('Job');
  });

  it('restores the previous name when the request fails', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useFoldersTest, { wrapper: makeWrapper([WORK]) });

    await act(async () => {
      await result.current.actions.renameFolder('f-1', 'Job').catch(() => {});
    });

    expect(result.current.folders[0]?.name).toBe('Work');
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

  it('throws when the hooks are used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useFolders)).toThrow(/must be used within a FoldersProvider/);
    spy.mockRestore();
  });
});
