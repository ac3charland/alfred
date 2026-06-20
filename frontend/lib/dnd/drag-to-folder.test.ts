import { INBOX_DROP_ID, resolveFolderDrop } from './drag-to-folder';

describe('resolveFolderDrop', () => {
  it('no-ops when the task was dropped on nothing (over = null)', () => {
    expect(resolveFolderDrop('t1', null, null)).toBeNull();
  });

  it('no-ops on a null drop even when the task currently lives in a folder', () => {
    // A non-null currentFolderId makes the `overId === null` guard the only thing returning
    // null — without it the function would emit a spurious move to the Inbox.
    expect(resolveFolderDrop('t1', null, 'f1')).toBeNull();
  });

  it('files an inbox task into a folder', () => {
    expect(resolveFolderDrop('t1', 'f1', null)).toEqual({ itemId: 't1', folderId: 'f1' });
  });

  it('moves a filed task back to the Inbox via the sentinel drop id', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, 'f1')).toEqual({ itemId: 't1', folderId: null });
  });

  it('moves a task from one folder to another', () => {
    expect(resolveFolderDrop('t1', 'f2', 'f1')).toEqual({ itemId: 't1', folderId: 'f2' });
  });

  it('no-ops when dropped onto the folder it already lives in', () => {
    expect(resolveFolderDrop('t1', 'f1', 'f1')).toBeNull();
  });

  it('no-ops when an inbox task is dropped back onto the Inbox', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, null)).toBeNull();
  });
});
