'use client';

import { Check, FolderOpen, Inbox, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { createFolder, deleteFolder, updateFolder } from '@/lib/api-client';
import type { Folder } from '@/lib/types';
import { cn } from '@/lib/utilities';

interface FolderNavProperties {
  folders: Folder[];
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/**
 * Sidebar navigation: Inbox link, folder list with CRUD, Completed link.
 * Handles folder creation, rename, and delete inline.
 */
export function FolderNav({ folders, onClose }: FolderNavProperties) {
  const pathname = usePathname();
  const router = useRouter();

  const [isCreating, setIsCreating] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [editingFolderId, setEditingFolderId] = React.useState<string | undefined>();
  const [editingName, setEditingName] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  const isActive = (path: string) => pathname === path;

  // exactOptionalPropertyTypes: only spread onClick if onClose is defined,
  // otherwise `(() => void) | undefined` is not assignable to `MouseEventHandler`.
  const closeProperty = onClose ? { onClick: onClose } : {};

  const handleCreateFolder = async (event_?: React.SyntheticEvent) => {
    event_?.preventDefault();
    const name = newFolderName.trim();
    if (!name || isPending) return;
    setIsPending(true);
    try {
      await createFolder(name);
      setNewFolderName('');
      setIsCreating(false);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = editingName.trim();
    if (!name || isPending) return;
    setIsPending(true);
    try {
      await updateFolder(id, name);
      setEditingFolderId(undefined);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (isPending) return;
    setIsPending(true);
    try {
      await deleteFolder(id);
      // Navigate to inbox if we were in the deleted folder
      if (pathname === `/folders/${id}`) {
        router.push('/');
      }
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const navLinkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      active
        ? 'bg-secondary text-foreground font-medium'
        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
    );

  return (
    <nav aria-label="Navigation" className="flex flex-col gap-1 py-2">
      {/* Inbox — reveals the inbox list on the landing route */}
      <Link href="/?view=inbox" className={navLinkClass(isActive('/'))} {...closeProperty}>
        <Inbox size={15} className="shrink-0" />
        <span>Inbox</span>
      </Link>

      {/* Folders section */}
      <div className="mt-4">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
            Folders
          </span>
          <button
            type="button"
            onClick={() => {
              setIsCreating(true);
            }}
            aria-label="Create folder"
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'transition-colors motion-reduce:transition-none',
            )}
          >
            <Plus size={13} />
          </button>
        </div>

        {/* New folder form */}
        {isCreating && (
          <form
            onSubmit={(event_) => {
              void handleCreateFolder(event_);
            }}
            className="flex items-center gap-1 px-2 py-1"
          >
            <input
              type="text"
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
              className={cn(
                'flex-1 rounded-sm border border-border bg-input px-2 py-1 text-sm text-foreground',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              )}
            />
            <button
              type="submit"
              disabled={isPending || !newFolderName.trim()}
              aria-label="Save folder"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded text-accent-teal',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
                'disabled:opacity-40',
              )}
            >
              <Check size={13} />
            </button>
          </form>
        )}

        {/* Folder list */}
        <div className="mt-1 flex flex-col gap-0.5">
          {folders.map((folder) => (
            <div key={folder.id} className="group/folder flex items-center gap-1 pr-1">
              {editingFolderId === folder.id ? (
                <form
                  onSubmit={(event_) => {
                    event_.preventDefault();
                    void handleRenameFolder(folder.id);
                  }}
                  className="flex flex-1 items-center gap-1 pl-3"
                >
                  <input
                    type="text"
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
                    className={cn(
                      'flex-1 rounded-sm border border-border bg-input px-2 py-1 text-sm text-foreground',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                    )}
                  />
                  <button
                    type="submit"
                    disabled={isPending}
                    aria-label="Save rename"
                    className="flex h-6 w-6 items-center justify-center rounded text-accent-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal disabled:opacity-40"
                  >
                    <Check size={13} />
                  </button>
                </form>
              ) : (
                <>
                  <Link
                    href={`/folders/${folder.id}`}
                    className={cn(
                      navLinkClass(isActive(`/folders/${folder.id}`)),
                      'flex-1 min-w-0',
                    )}
                    {...closeProperty}
                  >
                    <FolderOpen size={14} className="shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </Link>

                  {/* Folder actions — on hover */}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity duration-100 motion-reduce:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingFolderId(folder.id);
                        setEditingName(folder.name);
                      }}
                      aria-label={`Rename ${folder.name}`}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteFolder(folder.id);
                      }}
                      aria-label={`Delete ${folder.name}`}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Completed */}
      <div className="mt-4 border-t border-border/50 pt-2">
        <Link href="/completed" className={navLinkClass(isActive('/completed'))} {...closeProperty}>
          <Check size={15} className="shrink-0" />
          <span>Completed</span>
        </Link>
      </div>
    </nav>
  );
}
