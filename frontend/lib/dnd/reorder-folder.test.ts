import {
  folderDragId,
  folderGapId,
  isFolderDrag,
  isFolderGap,
  parseFolderDragId,
  parseFolderGapId,
  resolveFolderReorder,
} from './reorder-folder';

describe('folderDragId / isFolderDrag / parseFolderDragId', () => {
  it('round-trips a folder id through the drag-id encoding', () => {
    const id = folderDragId('f-1');
    expect(isFolderDrag(id)).toBe(true);
    expect(parseFolderDragId(id)).toBe('f-1');
  });

  it('does not mistake a task row id (or null) for a folder drag', () => {
    expect(isFolderDrag('f-1')).toBe(false);
    expect(isFolderDrag(null)).toBe(false);
    expect(parseFolderDragId('f-1')).toBeNull();
  });

  it('rejects a drag id carrying no folder id', () => {
    expect(parseFolderDragId(folderDragId(''))).toBeNull();
  });
});

describe('folderGapId / isFolderGap / parseFolderGapId', () => {
  it('round-trips a slot index through the gap-id encoding', () => {
    expect(parseFolderGapId(folderGapId(0))).toBe(0);
    expect(parseFolderGapId(folderGapId(3))).toBe(3);
  });

  it('is distinguishable from a folder drag id and from a plain folder id', () => {
    expect(isFolderGap(folderGapId(1))).toBe(true);
    expect(isFolderGap(folderDragId('f-1'))).toBe(false);
    expect(isFolderGap('f-1')).toBe(false);
    expect(isFolderGap(null)).toBe(false);
  });

  it('rejects a malformed gap id', () => {
    expect(parseFolderGapId('__folder-gap__nope')).toBeNull();
    expect(parseFolderGapId('f-1')).toBeNull();
  });
});

describe('resolveFolderReorder', () => {
  // The list the sidebar renders, minus the dragged folder — the shape the handler builds.
  const others = [
    { id: 'f-1', sortOrder: 1 },
    { id: 'f-2', sortOrder: 2 },
  ];

  it('drops above the first folder → one rank below it', () => {
    expect(
      resolveFolderReorder({
        draggedId: 'f-3',
        draggedSortOrder: 3,
        otherFolders: others,
        insertIndex: 0,
      }),
    ).toStrictEqual({ folderId: 'f-3', sortOrder: 0 });
  });

  it('drops between two folders → the midpoint of their ranks', () => {
    expect(
      resolveFolderReorder({
        draggedId: 'f-3',
        draggedSortOrder: 3,
        otherFolders: others,
        insertIndex: 1,
      }),
    ).toStrictEqual({ folderId: 'f-3', sortOrder: 1.5 });
  });

  it('drops below the last folder → one rank above it', () => {
    expect(
      resolveFolderReorder({
        draggedId: 'f-1',
        draggedSortOrder: 1,
        otherFolders: [
          { id: 'f-2', sortOrder: 2 },
          { id: 'f-3', sortOrder: 3 },
        ],
        insertIndex: 2,
      }),
    ).toStrictEqual({ folderId: 'f-1', sortOrder: 4 });
  });

  it('is a no-op for the only folder in the list (both its gaps are its own slot)', () => {
    expect(
      resolveFolderReorder({
        draggedId: 'f-1',
        draggedSortOrder: 7,
        otherFolders: [],
        insertIndex: 0,
      }),
    ).toBeNull();
  });

  it('is a no-op when the folder is dropped back into the slot it already occupies', () => {
    // 'f-2' sits between 'f-1' (1) and 'f-3' (3); both gaps flanking it map to insertIndex 1.
    expect(
      resolveFolderReorder({
        draggedId: 'f-2',
        draggedSortOrder: 2,
        otherFolders: [
          { id: 'f-1', sortOrder: 1 },
          { id: 'f-3', sortOrder: 3 },
        ],
        insertIndex: 1,
      }),
    ).toBeNull();
  });

  it('still moves when the drop is one slot away from the current position', () => {
    expect(
      resolveFolderReorder({
        draggedId: 'f-2',
        draggedSortOrder: 2,
        otherFolders: [
          { id: 'f-1', sortOrder: 1 },
          { id: 'f-3', sortOrder: 3 },
        ],
        insertIndex: 0,
      }),
    ).toStrictEqual({ folderId: 'f-2', sortOrder: 0 });
  });
});
