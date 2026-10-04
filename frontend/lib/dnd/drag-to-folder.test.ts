import { INBOX_DROP_ID, resolveFolderDrop } from './drag-to-folder';

const DISPATCHED_AT = '2026-01-01T00:00:00.000Z';
/** In the Inbox, no folder label. */
const inbox = { folder_id: null, dispatched_at: null };
/** Still in the Inbox, but labelled (e.g. by the classifier) with the folder it would land in. */
const labelledF1 = { folder_id: 'f1', dispatched_at: null };
/** Filed (dispatched) into f1. */
const filedF1 = { folder_id: 'f1', dispatched_at: DISPATCHED_AT };

describe('resolveFolderDrop', () => {
  it('no-ops when the task was dropped on nothing (over = null)', () => {
    expect(resolveFolderDrop('t1', null, inbox)).toBeNull();
  });

  it('no-ops on a null drop even when the task currently lives in a folder', () => {
    // A filed task makes the `overId === null` guard the only thing returning null — without it
    // the function would emit a spurious move to the Inbox.
    expect(resolveFolderDrop('t1', null, filedF1)).toBeNull();
  });

  it('files an inbox task into a folder', () => {
    expect(resolveFolderDrop('t1', 'f1', inbox)).toEqual({ itemId: 't1', folderId: 'f1' });
  });

  it('moves a filed task back to the Inbox via the sentinel drop id', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, filedF1)).toEqual({
      itemId: 't1',
      folderId: null,
    });
  });

  it('moves a task from one folder to another', () => {
    expect(resolveFolderDrop('t1', 'f2', filedF1)).toEqual({ itemId: 't1', folderId: 'f2' });
  });

  it('no-ops when dropped onto the folder it already lives in', () => {
    expect(resolveFolderDrop('t1', 'f1', filedF1)).toBeNull();
  });

  it('no-ops when an inbox task is dropped back onto the Inbox', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, inbox)).toBeNull();
  });

  // ALF-216: a folder label on an undispatched row says where it WOULD land, not where it lives —
  // the row is still in the Inbox, so its labelled folder is a real destination.
  it('files a labelled inbox task into the very folder it is labelled with', () => {
    expect(resolveFolderDrop('t1', 'f1', labelledF1)).toEqual({ itemId: 't1', folderId: 'f1' });
  });

  it('files a labelled inbox task into a different folder', () => {
    expect(resolveFolderDrop('t1', 'f2', labelledF1)).toEqual({ itemId: 't1', folderId: 'f2' });
  });

  it('no-ops when a labelled inbox task is dropped back onto the Inbox it lives in', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, labelledF1)).toBeNull();
  });
});
