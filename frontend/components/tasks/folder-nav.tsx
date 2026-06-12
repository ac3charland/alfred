'use client';

import { Check, FolderOpen, Inbox, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { TextField } from '@/components/atoms/text-field';
import { FolderDropZone } from '@/components/tasks/folder-drop-zone';
import { ViewLink } from '@/components/tasks/view-link';
import { INBOX_DROP_ID } from '@/lib/dnd/drag-to-folder';
import { useFolderActions, useFolders } from '@/lib/stores/folders-store';
import { cn } from '@/lib/utils';

interface FolderNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/** Shared styling for a nav link, highlighted when it points at the active route. */
const navLinkClass = (active: boolean) =>
  cn(
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
    'flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active
      ? 'bg-secondary text-foreground font-medium'
      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
  );

/**
 * Sidebar navigation: Inbox link, folder list with CRUD, Completed link.
 *
 * Reads the folder list from the FoldersProvider store and mutates through its
 * optimistic actions — the list updates instantly and reconciles with the server
 * (no router.refresh()).
 */
export function FolderNav({ onClose }: FolderNavProperties) {
  const pathname = usePathname();
  const router = useRouter();
  const folders = useFolders();
  const { addFolder, renameFolder, removeFolder } = useFolderActions();

  const [isCreating, setIsCreating] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [editingFolderId, setEditingFolderId] = React.useState<string | undefined>();
  // Stryker disable next-line StringLiteral: AT_CEILING — editingName's initial value is always overwritten by setEditingName(folder.name) in the same onClick that sets editingFolderId, before the rename input ever renders; never observable — equivalent.
  const [editingName, setEditingName] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  const isActive = (path: string) => pathname === path;

  // exactOptionalPropertyTypes: only spread onClick if onClose is defined,
  // otherwise `(() => void) | undefined` is not assignable to `MouseEventHandler`.
  const closeProperty = onClose ? { onClick: onClose } : {};

  const handleCreateFolder = async (event_?: React.SyntheticEvent) => {
    // Stryker disable next-line OptionalChaining: AT_CEILING — handleCreateFolder's only caller is the form onSubmit (line ~131), which always passes a defined SyntheticEvent; the optional chain never short-circuits in reachable code — equivalent.
    event_?.preventDefault();
    const name = newFolderName.trim();
    if (!name || isPending) return;
    setIsPending(true);
    try {
      await addFolder(name);
      setNewFolderName('');
      setIsCreating(false);
    } catch {
      // The store already rolled back; keep the form open so the user can retry.
    } finally {
      setIsPending(false);
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = editingName.trim();
    if (!name || isPending) return;
    setIsPending(true);
    try {
      await renameFolder(id, name);
      setEditingFolderId(undefined);
    } catch {
      // The store already restored the previous name.
    } finally {
      setIsPending(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (isPending) return;
    setIsPending(true);
    const wasActive = pathname === `/folders/${id}`;
    try {
      await removeFolder(id);
      // Leave the deleted folder's page only once the delete succeeds.
      if (wasActive) {
        router.push('/');
      }
    } catch {
      // The store already restored the folder.
    } finally {
      setIsPending(false);
    }
  };

  return (
    <nav aria-label="Navigation" className="flex flex-col gap-1 py-2">
      {/* Inbox — reveals the inbox list on the landing route, and is a drop target */}
      <FolderDropZone id={INBOX_DROP_ID}>
        <ViewLink href="/?view=inbox" className={navLinkClass(isActive('/'))} {...closeProperty}>
          <Inbox size={15} className="shrink-0" />
          <span>Inbox</span>
        </ViewLink>
      </FolderDropZone>

      {/* Folders section */}
      <div className="mt-4">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
            Folders
          </span>
          <IconButton
            size="sm"
            onClick={() => {
              setIsCreating(true);
            }}
            aria-label="Create folder"
          >
            <Plus size={13} />
          </IconButton>
        </div>

        {/* New folder form */}
        {isCreating && (
          <form
            onSubmit={(event_) => {
              void handleCreateFolder(event_);
            }}
            className="flex items-center gap-1 px-2 py-1"
          >
            <TextField
              value={newFolderName}
              onChange={(event_) => {
                setNewFolderName(event_.target.value);
              }}
              onKeyDown={(event_) => {
                if (event_.key === 'Escape') {
                  setIsCreating(false);
                  setNewFolderName('');
                }
              }}
              placeholder="Folder name…"
              // autoFocus intentionally omitted — jsx-a11y/no-autofocus
              className="flex-1"
            />
            <IconButton
              type="submit"
              tone="affirm"
              disabled={isPending || !newFolderName.trim()}
              aria-label="Save folder"
            >
              <Check size={13} />
            </IconButton>
          </form>
        )}

        {/* Folder list */}
        <div className="mt-1 flex flex-col gap-0.5">
          {folders.map((folder) => (
            <FolderDropZone key={folder.id} id={folder.id}>
              <div className="group/folder flex items-center gap-1 pr-1">
                {editingFolderId === folder.id ? (
                  <form
                    onSubmit={(event_) => {
                      event_.preventDefault();
                      void handleRenameFolder(folder.id);
                    }}
                    className="flex flex-1 items-center gap-1 pl-3"
                  >
                    <TextField
                      value={editingName}
                      onChange={(event_) => {
                        setEditingName(event_.target.value);
                      }}
                      onKeyDown={(event_) => {
                        if (event_.key === 'Escape') {
                          setEditingFolderId(undefined);
                        }
                      }}
                      // autoFocus intentionally omitted — jsx-a11y/no-autofocus
                      className="flex-1"
                    />
                    <IconButton
                      type="submit"
                      tone="affirm"
                      disabled={isPending}
                      aria-label="Save rename"
                    >
                      <Check size={13} />
                    </IconButton>
                  </form>
                ) : (
                  <>
                    <ViewLink
                      href={`/folders/${folder.id}`}
                      className={cn(
                        navLinkClass(isActive(`/folders/${folder.id}`)),
                        // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                        'flex-1 min-w-0',
                      )}
                      {...closeProperty}
                    >
                      <FolderOpen size={14} className="shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </ViewLink>

                    {/* Folder actions — on hover */}
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity duration-100 motion-reduce:opacity-100">
                      <IconButton
                        size="sm"
                        onClick={() => {
                          setEditingFolderId(folder.id);
                          setEditingName(folder.name);
                        }}
                        aria-label={`Rename ${folder.name}`}
                      >
                        <MoreHorizontal size={12} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        tone="danger"
                        onClick={() => {
                          void handleDeleteFolder(folder.id);
                        }}
                        aria-label={`Delete ${folder.name}`}
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  </>
                )}
              </div>
            </FolderDropZone>
          ))}
        </div>
      </div>

      {/* Completed */}
      <div className="mt-4 border-t border-border/50 pt-2">
        <ViewLink
          href="/completed"
          className={navLinkClass(isActive('/completed'))}
          {...closeProperty}
        >
          <Check size={15} className="shrink-0" />
          <span>Completed</span>
        </ViewLink>
      </div>
    </nav>
  );
}
