import { useFolders } from '@/lib/stores/folders-store';
import { residentFolderId } from '@/lib/tasks/residency';
import type { Item } from '@/lib/types';

/**
 * The label a cross-cutting list puts on a top-level row: the name of the folder it RESIDES in
 * (see `residentFolderId`), or "Inbox". Residency, not `folder_id`, so a task still awaiting
 * triage reads "Inbox" even when it already carries a folder — the view it actually renders in.
 *
 * Must be mounted under a `FoldersProvider`.
 */
export function useBucketName(): (task: Item) => string {
  const folders = useFolders();
  return (task) => {
    const folderId = residentFolderId(task);
    return folderId === null
      ? 'Inbox'
      : (folders.find((folder) => folder.id === folderId)?.name ?? 'Unknown');
  };
}
