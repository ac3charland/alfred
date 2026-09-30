import { INBOX_DROP_ID, resolveFolderDrop } from './drag-to-folder';

const DISPATCHED_AT = '2026-08-01T10:00:00Z';

/** An item still in the Inbox, optionally labelled with the folder it would land in. */
const inboxItem = (folderId: string | null = null) => ({
  folder_id: folderId,
  dispatched_at: null,
});

/** An item a human has dispatched into `folderId`. */
const filedIn = (folderId: string) => ({ folder_id: folderId, dispatched_at: DISPATCHED_AT });

describe('resolveFolderDrop', () => {
  it('no-ops when the task was dropped on nothing (over = null)', () => {
    expect(resolveFolderDrop('t1', null, inboxItem())).toBeNull();
  });

  it('no-ops on a null drop even when the task currently lives in a folder', () => {
    // A task living in a folder makes the `overId === null` guard the only thing returning
    // null — without it the function would emit a spurious move to the Inbox.
    expect(resolveFolderDrop('t1', null, filedIn('f1'))).toBeNull();
  });

  it('files an inbox task into a folder', () => {
    expect(resolveFolderDrop('t1', 'f1', inboxItem())).toEqual({ itemId: 't1', folderId: 'f1' });
  });

  it('files an inbox task into the very folder it is already labelled with (ALF-216)', () => {
    // The label says where it WOULD land; it still lives in the Inbox, so this is a real move.
    expect(resolveFolderDrop('t1', 'f1', inboxItem('f1'))).toEqual({
      itemId: 't1',
      folderId: 'f1',
    });
  });

  it('moves a filed task back to the Inbox via the sentinel drop id', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, filedIn('f1'))).toEqual({
      itemId: 't1',
      folderId: null,
    });
  });

  it('moves a task from one folder to another', () => {
    expect(resolveFolderDrop('t1', 'f2', filedIn('f1'))).toEqual({ itemId: 't1', folderId: 'f2' });
  });

  it('no-ops when dropped onto the folder it already lives in', () => {
    expect(resolveFolderDrop('t1', 'f1', filedIn('f1'))).toBeNull();
  });

  it('no-ops when an inbox task is dropped back onto the Inbox', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, inboxItem())).toBeNull();
  });

  it('no-ops when a labelled inbox task is dropped onto the Inbox it still lives in', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, inboxItem('f1'))).toBeNull();
  });
});
