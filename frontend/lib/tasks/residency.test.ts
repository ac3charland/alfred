import { isDispatched, residentFolderId } from './residency';

describe('isDispatched', () => {
  it('is false while the item is still in the Inbox', () => {
    expect(isDispatched({ dispatched_at: null })).toBe(false);
  });

  it('is true once a dispatch has stamped the item', () => {
    expect(isDispatched({ dispatched_at: '2026-08-01T10:00:00Z' })).toBe(true);
  });
});

describe('residentFolderId', () => {
  // The four rows of the residency truth table: `folder_id` is where the item WOULD land,
  // `dispatched_at` is whether it has actually left the Inbox.
  it('is null for a plain capture', () => {
    expect(residentFolderId({ dispatched_at: null, folder_id: null })).toBeNull();
  });

  it('is null for an undispatched item that already carries a folder', () => {
    expect(residentFolderId({ dispatched_at: null, folder_id: 'f1' })).toBeNull();
  });

  it('is the folder for a dispatched item', () => {
    expect(residentFolderId({ dispatched_at: '2026-08-01T10:00:00Z', folder_id: 'f1' })).toBe('f1');
  });

  it('is null for a dispatched item with no folder (a code item on its way to the factory)', () => {
    expect(residentFolderId({ dispatched_at: '2026-08-01T10:00:00Z', folder_id: null })).toBeNull();
  });
});
