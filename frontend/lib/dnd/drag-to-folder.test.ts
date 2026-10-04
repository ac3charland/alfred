import { INBOX_DROP_ID, resolveFolderDrop } from './drag-to-folder';

/** An undispatched (Inbox-resident) row, optionally carrying a classifier's folder label. */
const inInbox = (folderId: string | null = null) => ({ folder_id: folderId, dispatched_at: null });
/** A row a human has filed into `folderId`. */
const filedIn = (folderId: string) => ({
  folder_id: folderId,
  dispatched_at: '2026-01-01T00:00:00.000Z',
});

describe('resolveFolderDrop', () => {
  it('no-ops when the task was dropped on nothing (over = null)', () => {
    expect(resolveFolderDrop('t1', null, inInbox())).toBeNull();
  });

  it('no-ops on a null drop even when the task currently lives in a folder', () => {
    // A filed task makes the `overId === null` guard the only thing returning null — without
    // it the function would emit a spurious move to the Inbox.
    expect(resolveFolderDrop('t1', null, filedIn('f1'))).toBeNull();
  });

  it('files an inbox task into a folder', () => {
    expect(resolveFolderDrop('t1', 'f1', inInbox())).toEqual({ itemId: 't1', folderId: 'f1' });
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
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, inInbox())).toBeNull();
  });

  // ALF-216: a classifier's folder label is where the item WOULD land, not where it lives — an
  // undispatched row is still in the Inbox, so dropping it on its labelled folder files it there.
  it('files an inbox item into the folder its label already names', () => {
    expect(resolveFolderDrop('t1', 'f1', inInbox('f1'))).toEqual({ itemId: 't1', folderId: 'f1' });
  });

  it('no-ops when a labelled inbox item is dropped back onto the Inbox, keeping its label', () => {
    expect(resolveFolderDrop('t1', INBOX_DROP_ID, inInbox('f1'))).toBeNull();
  });
});
